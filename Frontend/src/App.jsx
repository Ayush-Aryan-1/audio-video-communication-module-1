
import {useEffect,useRef,useState} from 'react';
import './App.css';
import {io} from "socket.io-client";
import VideoCall from './video_call';

const turnUrls = import.meta.env.VITE_TURN_URLS
  ?.split(',')
  .map((url) => url.trim())
  .filter(Boolean) ?? [];
const turnUsername = import.meta.env.VITE_TURN_USERNAME?.trim();
const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

if (turnUrls.length > 0 && (!turnUsername || !turnCredential)) {
  console.error(
    'TURN URLs are configured, but VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL are required.'
  );
}

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(turnUrls.length > 0 && turnUsername && turnCredential
    ? [{ urls: turnUrls, username: turnUsername, credential: turnCredential }]
    : []),
];

console.info('WebRTC ICE configuration:', {
  turnConfigured: iceServers.length > 1,
  turnServerCount: turnUrls.length,
});

async function logIceConnectionType(peer, userId) {
  const stats = await peer.getStats();

  let selectedPair;

  stats.forEach((report) => {
    if (
      report.type === "candidate-pair" &&
      report.state === "succeeded" &&
      report.nominated
    ) {
      selectedPair = report;
    }
  });

  if (!selectedPair) {
    console.log(`⏳ No selected ICE candidate pair yet for ${userId}`);
    return;
  }

  const localCandidate = stats.get(selectedPair.localCandidateId);
  const remoteCandidate = stats.get(selectedPair.remoteCandidateId);

  if (
    localCandidate?.candidateType === "relay" ||
    remoteCandidate?.candidateType === "relay"
  ) {
    console.log(`👍 TURN SERVER IS WORKING with user: ${userId}`, {
      localCandidate: localCandidate?.candidateType,
      remoteCandidate: remoteCandidate?.candidateType,
    });
    alert("🚨Using Turn");
  } else {
    console.log(`✅ Direct connection (no TURN relay) with user: ${userId}`, {
      localCandidate: localCandidate?.candidateType,
      remoteCandidate: remoteCandidate?.candidateType,
    });
  }
}


function App() {
  const [cameraFacingMode, setCameraFacingMode] = useState('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [cameraError, setCameraError] = useState('');
  //DECLARATIONS
  // signalling 
  const serverUrl = import.meta.env.DEV
    ? window.location.origin
    : import.meta.env.VITE_SERVER_URL;
  const socketRef=useRef(null);
  //video audio 
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const mediaReadyRef = useRef(null);
  const cameraSwitchInProgressRef = useRef(false);
  //new
  const pendingCandidatesRef = useRef(new Map);
  const peersRef = useRef(new Map());
  const [remoteStreams,setRemoteStreams]=useState([]);

  
  //video audio connection
  useEffect(() => {
      let cancelled = false;
      const localVideo = localVideoRef.current;
      const peers = peersRef.current;
      const pendingCandidates = pendingCandidatesRef.current;

      const startCamera = async () => {

          const stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: 'user' } },
              audio: true
          });
          if (cancelled) {
            stream.getTracks().forEach((track)=>track.stop());
            return;
          }
          localStreamRef.current = stream;
          setCameraReady(true);
          if (localVideo) {
            localVideo.srcObject = stream;
          }
      };

      mediaReadyRef.current = startCamera();

      return () => {
          cancelled = true;
          localVideo?.srcObject?.getTracks().forEach((track)=>track.stop());
          if (localVideo) {
            localVideo.srcObject = null;
          }
          localStreamRef.current = null;
          for(const peer of peers.values()){
            peer.close();
          }
          peers.clear();
          pendingCandidates.clear();
          setRemoteStreams([]);
      };

  }, []);

  //camera switching
  
  const switchCamera = async () => {
    if (cameraSwitchInProgressRef.current) return;

    const localStream = localStreamRef.current;
    const currentVideoTrack = localStream?.getVideoTracks()[0];
    const nextFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    if (!localStream || !currentVideoTrack) {
      setCameraError('The camera is not ready yet.');
      return;
    }

    cameraSwitchInProgressRef.current = true;
    setCameraSwitching(true);
    setCameraError('');

    let nextVideoTrack;
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: nextFacingMode } },
        audio: false
      });
      nextVideoTrack = nextStream.getVideoTracks()[0];
      if (!nextVideoTrack) {
        throw new Error('No video track was returned by the selected camera.');
      }

      const videoSenders = [];
      for (const peer of peersRef.current.values()) {
        const sender = peer.getSenders().find(
          (sender) => sender.track?.kind === 'video'
        );
        if (sender) {
          videoSenders.push(sender);
        }
      }
      //remote update
      await Promise.all(videoSenders.map((sender) =>
          sender.replaceTrack(nextVideoTrack)
        ));
      //local update
      localStream.removeTrack(currentVideoTrack);
      localStream.addTrack(nextVideoTrack);

      currentVideoTrack.stop();
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      setCameraFacingMode(nextFacingMode);
    } catch (error) {
      nextVideoTrack?.stop();
      console.error('Failed to switch camera:', error);
      setCameraError(`Unable to switch camera: ${error.message}`);
    } finally {
      cameraSwitchInProgressRef.current = false;
      setCameraSwitching(false);
    }
  };

  // signalling connection
  useEffect(() => {
    let cancelled = false;

    mediaReadyRef.current
      .then(() => {
    if (cancelled) return;

    socketRef.current = io(serverUrl, {
        transports: ["websocket"]
    });

    //functiionss

    const addPendingCandidates = async (userId ,peer) => {
      const candidatesOfUser = pendingCandidatesRef.current.get(userId) || [];

      for (const candidate of candidatesOfUser) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (error) {
          console.error("Failed to add queued ICE candidate:", error);
        }
      }
      pendingCandidatesRef.current.delete(userId);
    };

    const configurePeerConnection = (peer,userId) => {
      peer.onicecandidate = (e) => {
        if (e.candidate && userId) {
          console.log(`Local ICE candidate for ${userId}:`, {
            type: e.candidate.type,
            protocol: e.candidate.protocol,
            url: e.candidate.url,
          });
          socketRef.current.emit("candidate", {
            candidate: e.candidate,
            target: userId
          });
        }
      };
      peer.onicecandidateerror = (event) => {
        console.error(`ICE candidate gathering failed for ${userId}:`, {
          url: event.url,
          errorCode: event.errorCode,
          errorText: event.errorText,
        });
      };
      peer.ontrack = (e) => {
        console.log("🔥 REMOTE TRACK:", e.streams[0]);
        const stream = e.streams[0];
        if(!stream) return ;

        setRemoteStreams((previous) => {
          const exists=previous.some((item)=>
            item.userId === userId 
          );
          if(exists){
            return previous.map((item)=>
              item.userId === userId
              ? { ...item, stream }
              : item
            )
          }
          return [...previous, { userId, stream }];
        });
      };

      peer.onconnectionstatechange = () => {
        console.log(`CONNECTION with ${userId}:`, peer.connectionState);
        if (peer.connectionState === "connected") {
          logIceConnectionType(peer, userId).catch(console.error);
        }
      };
      peer.oniceconnectionstatechange = () => {
        console.log(
          `ICE state with ${userId}:`,
          peer.iceConnectionState
        );
      };

      peer.onicegatheringstatechange = () => {
        console.log(
          `ICE gathering with ${userId}:`,
          peer.iceGatheringState
        );
      };

      peer.onsignalingstatechange = () => {
        console.log(
          `Signaling with ${userId}:`,
          peer.signalingState
        );
      };
    };

    const ensurePeerConnection = (userId) => {
      const existingPeer = peersRef.current.get(userId);
      if(existingPeer && existingPeer.signalingState!=="closed") return existingPeer;
      
      const peer = new RTCPeerConnection({
        iceServers,
      });
      configurePeerConnection(peer,userId);

      const localStream = localStreamRef.current;
      if (!localStream) {
        throw new Error("Local media stream is not ready");
      }
      localStream.getTracks().forEach((track) => {
        peer.addTrack(track, localStream);
      });



      peersRef.current.set(userId, peer);
      return peer;
    };

    //main useeffect work

    socketRef.current.on("connect",()=>{
      console.log(`Connected: ${socketRef.current.id}`);
      socketRef.current.emit("join-room","abc123");
    })
    socketRef.current.on("connect_error",(error)=>{
      console.error('Socket connection failed:', error.message);
    })

    socketRef.current.on("user-joined", (userId) => {
        console.log(`New user joined: ${userId}`);
    });
    socketRef.current.on("user-left", (userId) => {
      console.log(`User left: ${userId}`);
      //clearance
      const peer = peersRef.current.get(userId);

        if (peer) {
          peer.close();
          peersRef.current.delete(userId);
        }

        pendingCandidatesRef.current.delete(userId);

        setRemoteStreams((previous) =>
          previous.filter((item) => item.userId !== userId)
        );
    });
    
    // webRtc connection

    socketRef.current.on("existing-users", async (users) => {
      console.log("Existing users:", users);
       for (const Id of users){
          try {
            const peer = ensurePeerConnection(Id);
            //offering 
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            
            socketRef.current.emit("offer",{
              offer,
              target : Id
            });

            
          } catch (error) {
            console.log("Failed to create offer:", error);
          }
        }
    });
    
    socketRef.current.on("offer",async ({offer,from})=>{

      try {
      const peer = ensurePeerConnection(from);
      await peer.setRemoteDescription(offer);

      await addPendingCandidates(from,peer);

       const answer = await peer.createAnswer();
       await peer.setLocalDescription(answer);

      socketRef.current.emit("answer",{
        answer,
        target:from
      });
      console.log("answer sent to ", from );
      
    }catch(error){
        console.error("failed to handle offer",error);
      }
    })


    socketRef.current.on("answer",async ({answer,from})=>{
      try {
      const peer = peersRef.current.get(from);

      if (!peer) {
        console.error("No peer connection found for:", from);
        return;
      }
      await peer.setRemoteDescription(answer);
      await addPendingCandidates(from,peer);

      console.log("connection done with :", from);
      }catch(error){
        console.error("answer handling fucked ",error);
      }
    })


    //candidate validation
    socketRef.current.on("candidate", async ({ candidate, from }) => {
      try {
        const candidateType = candidate.type ??
          candidate.candidate?.match(/\btyp\s+(host|srflx|prflx|relay)\b/)?.[1];
        const candidateProtocol = candidate.protocol ??
          candidate.candidate?.match(/^\w+\s+\d+\s+(udp|tcp)\s/i)?.[1]?.toLowerCase();
        console.log(`Remote ICE candidate for ${from}:`, {
          type: candidateType,
          protocol: candidateProtocol,
        });

        const peer = peersRef.current.get(from);
        if (!peer) {
          const queued = pendingCandidatesRef.current.get(from) || [];
          queued.push(candidate);
          pendingCandidatesRef.current.set(from, queued);
          return;
        }
        if (peer.remoteDescription) {
          await peer.addIceCandidate(candidate);
        } else {
          const queued = pendingCandidatesRef.current.get(from) || [];
          queued.push(candidate);
          pendingCandidatesRef.current.set(from, queued);
        }
      }catch (error) {
        console.error("Failed to add ICE candidate:", error);
      }
    });





    socketRef.current.on("disconnect",()=>{
      console.log(`Disconnected: ${socketRef.current.id}`);
    })

      })
      .catch((error) => {
        console.error("Failed to initialize media before signaling:", error);
      });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl])


  return (
    <VideoCall
      localVideoRef={localVideoRef}
      remoteStreams={remoteStreams}
      cameraFacingMode={cameraFacingMode}
      cameraReady={cameraReady}
      cameraSwitching={cameraSwitching}
      cameraError={cameraError}
      onSwitchCamera={switchCamera}
    />
  )
}

export default App

