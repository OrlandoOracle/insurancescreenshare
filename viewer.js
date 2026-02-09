// Mirror Viewer — WebRTC screen receiver
(function () {
  "use strict";

  const SIGNALING_URL_PROD = "wss://mirror-signaling.fly.dev";
  const SIGNALING_URL_DEV = "ws://localhost:8081";
  const STUN_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  // Get room ID from URL
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");

  if (!roomId) {
    setStatus("error", "No room ID provided");
    setOverlay("No Room ID", "Add ?room=XXXX to the URL");
    return;
  }

  // Determine signaling URL (use dev if localhost)
  const isDev =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const signalingUrl = isDev ? SIGNALING_URL_DEV : SIGNALING_URL_PROD;

  let ws = null;
  let pc = null;

  // DOM elements
  const video = document.getElementById("remote-video");
  const overlay = document.getElementById("overlay");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const overlayText = document.getElementById("overlay-text");
  const overlaySub = document.getElementById("overlay-sub");

  // Connect to signaling server
  function connect() {
    setStatus("waiting", "Connecting to server...");
    setOverlay("Connecting...", "Establishing secure connection");

    ws = new WebSocket(signalingUrl);

    ws.onopen = function () {
      // Join the room
      ws.send(JSON.stringify({ type: "join-room", roomId: roomId }));
      setStatus("waiting", "Waiting for presenter...");
      setOverlay("Waiting for Presenter", "The presenter hasn't started sharing yet");
    };

    ws.onmessage = function (event) {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "joined-room":
          setStatus("waiting", "In room — waiting for stream...");
          break;

        case "error":
          setStatus("error", msg.message || "Connection error");
          setOverlay("Error", msg.message || "Could not join room");
          break;

        case "offer":
          handleOffer(msg.sdp);
          break;

        case "ice-candidate":
          handleRemoteCandidate(msg.candidate);
          break;

        case "presenter-left":
          setStatus("error", "Presenter disconnected");
          setOverlay("Disconnected", "The presenter has stopped sharing");
          video.classList.remove("active");
          overlay.classList.remove("hidden");
          if (pc) {
            pc.close();
            pc = null;
          }
          break;
      }
    };

    ws.onclose = function () {
      setStatus("error", "Connection lost");
      setOverlay("Connection Lost", "Trying to reconnect...");
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    ws.onerror = function () {
      setStatus("error", "Connection failed");
    };
  }

  // Handle SDP offer from presenter
  async function handleOffer(sdp) {
    setStatus("waiting", "Setting up stream...");

    pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

    pc.ontrack = function (event) {
      video.srcObject = event.streams[0];
      video.classList.add("active");
      overlay.classList.add("hidden");
      setStatus("live", "Live");
    };

    pc.onicecandidate = function (event) {
      if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "ice-candidate",
            roomId: roomId,
            candidate: {
              candidate: event.candidate.candidate,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sdpMid: event.candidate.sdpMid,
            },
          })
        );
      }
    };

    pc.oniceconnectionstatechange = function () {
      switch (pc.iceConnectionState) {
        case "connected":
        case "completed":
          setStatus("live", "Live");
          break;
        case "disconnected":
          setStatus("waiting", "Reconnecting...");
          break;
        case "failed":
          setStatus("error", "Connection failed");
          setOverlay("Connection Failed", "The stream was interrupted");
          break;
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(
        JSON.stringify({
          type: "answer",
          roomId: roomId,
          sdp: answer.sdp,
        })
      );
    } catch (err) {
      console.error("WebRTC error:", err);
      setStatus("error", "Stream setup failed");
      setOverlay("Error", "Failed to establish video stream");
    }
  }

  // Handle ICE candidate from presenter
  function handleRemoteCandidate(candidate) {
    if (pc && candidate) {
      pc.addIceCandidate(
        new RTCIceCandidate({
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex,
          sdpMid: candidate.sdpMid,
        })
      ).catch(function (err) {
        console.warn("ICE candidate error:", err);
      });
    }
  }

  // UI helpers
  function setStatus(state, text) {
    statusDot.className = state;
    statusText.textContent = text;
  }

  function setOverlay(title, sub) {
    overlayText.textContent = title;
    overlaySub.textContent = sub;
  }

  // Double-click for fullscreen
  video.addEventListener("dblclick", function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  // Start
  connect();
})();
