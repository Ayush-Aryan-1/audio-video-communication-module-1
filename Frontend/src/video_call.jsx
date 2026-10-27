import { useState } from 'react';
import './video_call.css';

export default function VideoCall({
  localVideoRef,
  remoteStreams,
  cameraFacingMode,
  cameraReady,
  cameraSwitching,
  cameraError,
  onSwitchCamera,
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const toggleMic = () => {
    const stream = localVideoRef.current?.srcObject;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((prev) => !prev);
  };

  const toggleCam = () => {
    const stream = localVideoRef.current?.srcObject;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCamOn((prev) => !prev);
  };

  const hasRemote = remoteStreams.length > 0;

  return (
    <div className="call-root">
      {/* ── main area ── */}
      <div className="call-stage">
        {hasRemote ? (
          <div className={`remote-grid remote-grid--${Math.min(remoteStreams.length, 4)}`}>
            {remoteStreams.map(({ userId, stream }) => (
              <div key={userId} className="remote-tile">
                <video
                  autoPlay
                  playsInline
                  ref={(el) => {
                    if (el && el.srcObject !== stream) el.srcObject = stream;
                  }}
                />
                <span className="remote-label">{userId.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        ) : (
          /* no one else — show local full-screen */
          <div className="solo-view">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={cameraFacingMode === 'user' ? 'mirror' : ''}
            />
            <p className="solo-hint">Waiting for others to join…</p>
          </div>
        )}

        {/* ── local pip (only when remotes exist) ── */}
        {hasRemote && (
          <div
            className={`local-pip ${localExpanded ? 'local-pip--lg' : ''}`}
            onClick={() => setLocalExpanded((p) => !p)}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={cameraFacingMode === 'user' ? 'mirror' : ''}
            />
          </div>
        )}
      </div>

      {/* ── controls ── */}
      <div className="call-bar">
        <button
          className={`ctl-btn ${!micOn ? 'ctl-btn--off' : ''}`}
          onClick={toggleMic}
          title={micOn ? 'Mute mic' : 'Unmute mic'}
        >
          {micOn ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          )}
        </button>

        <button
          className={`ctl-btn ${!camOn ? 'ctl-btn--off' : ''}`}
          onClick={toggleCam}
          title={camOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {camOn ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1 4.22 2.82a.5.5 0 0 0 .78-.42V7.93a.5.5 0 0 0-.78-.42L16 11"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          )}
        </button>

        <button
          className="ctl-btn"
          onClick={onSwitchCamera}
          disabled={!cameraReady || cameraSwitching}
          title="Switch camera"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><circle cx="12" cy="12" r="3"/><path d="m18 22-3-3 3-3"/><path d="m6 2 3 3-3 3"/></svg>
        </button>

        <button className="ctl-btn ctl-btn--end" title="Leave call">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4Z" transform="rotate(135 12 12)"/></svg>
        </button>
      </div>

      {cameraError && <p className="cam-error">{cameraError}</p>}
    </div>
  );
}
