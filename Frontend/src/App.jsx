
import {useEffect,useRef,useState} from 'react';
import './App.css';
import {io} from "socket.io-client";

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
          for(const peer of peersRef.current.values()){
            peer.close();
          }
          peersRef.current.clear();
          pendingCandidatesRef.current.clear();
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
          socketRef.current.emit("candidate", {
            candidate: e.candidate,
            target: userId
          });
        }
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
        console.log(`talking with ${from} on`, candidate);
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


  const [isExpanded,setIsExpanded]=useState(false);
  const [myControls,setMyControls]=useState(false);
  return (
    < >
      <div className="flex flex-col items-center justify-center min-h-screen bg-black w-full h-full">
        <h1 className=" text-gray-300 text-2xl font-bold">Minor Project </h1>
        <h2 className=" text-gray-300 text-lg font-semibold">Audio-Video Communication Module</h2>
        
        <div className="room w-full p-3 m-2 bg-zinc-900 border-5 border-stone-900 rounded-2xl h-175 md:h-150 flex">
          <div 
          
          onClick={()=>setIsExpanded(!isExpanded)}
          className= {` local rounded-lg p-3 w-fit 
          ${isExpanded ? 'max-w-100 sm:max-w-md md:max-w-xl lg:max-w-2xl' 
           : 'max-w-50 sm:max-w-2xs md:max-w-xs lg:max-w-s'}`}>

            <h1 className='text-teal-200'>Our Video</h1>
            <video
                ref={localVideoRef}
                autoPlay
                controls={false}
                muted
                playsInline
                className={` ${cameraFacingMode === 'user' ? 'scale-x-[-1]' : ''} rounded-lg w-full shadow-lg`}
            />
          </div>
            {/*remote videos */}
          <div className="flex flex-wrap justify-center gap-4 mt-4">
          {remoteStreams.map(({ userId, stream }) => (
            <div key={userId} className="flex flex-col items-center gap-2">
              <p className="text-gray-300 text-sm">
                Participant: {userId}
              </p>

              <video
                autoPlay
                playsInline
                muted
                controls
                ref={(video) => {
                  if (video && video.srcObject !== stream) {
                    video.srcObject = stream;
                  }
                }}
                className="w-72 rounded-lg"
              />
            </div>
          ))}
        </div>
        </div>
        
        {/* switch button */}
        <div className='m-4'>
          <button
              type="button"
              onClick={switchCamera}
              disabled={!cameraReady || cameraSwitching}
              className="mt-3 rounded bg-teal-500 px-4 py-2 font-semibold text-black  disabled:cursor-not-allowed disabled:opacity-50" >
              {cameraSwitching
                ? 'Switching camera...'
                : `Switch to ${cameraFacingMode === 'user' ? 'rear' : 'front'} camera`}
          
          </button>
          {cameraError && (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {cameraError}
            </p>
          )}
        </div>
        <footer className='text-amber-50'>
          <h2 className=" text-gray-300 text-[11px] font-normal"> Developed by: Ayush and Sumit </h2>
        </footer>
      </div>
    </>
  )
}

export default App
