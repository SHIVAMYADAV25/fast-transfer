// // apps/web/app/page.tsx
// "use client";

// import { useCallback, useEffect, useRef, useState } from "react";
// import { FileDropzone } from "@/components/file-dropzone";
// import { CodeDisplay } from "@/components/code-display";
// import { TransferProgress } from "@/components/transfer-progress";
// import { createRoom, checkRoom, SignalingClient, waitForMessage } from "@/lib/signaling/client";
// import { PeerConnection } from "@/lib/webrtc/peer";
// import { sendFiles, FileReceiver, downloadFile, type TransferProgress as Progress } from "@/lib/webrtc/transfer";
// import { StatsMonitor, type ConnectionType } from "@/lib/webrtc/stats";
// import {
//   establishParallelSenderConnections,
//   establishParallelReceiverConnections,
//   MAX_PARALLEL_CONNECTIONS,
//   chooseConnectionCount,
// } from "@/lib/webrtc/multi-peer";
// import { ConnectionStatus } from "@/components/connection-status";
// import { BenchmarkSummary } from "@/components/benchmark-summary";
// import { RelaySettings } from "@/components/relay-settings";
// import { getIceServers, type TurnOverride } from "@/lib/webrtc/ice-config";
// import { uploadStored, fetchStoredStatus, fetchStoredManifest, downloadStoredFiles, revokeStored, type StoreUploadProgress, type StoreDownloadProgress } from "@/lib/store/storeclient";
// import { deriveKeys, parseShareLink } from "@/lib/store/storecrypto";
// import { STORED_TRANSFER_DEFAULT_TTL_MS } from "@fast-transfer/protocol";
// import type { StoredManifest } from "@fast-transfer/protocol";
// import { formatBytes } from "@/lib/format";
// import { TutorialModal, useTutorialAutoOpen } from "@/components/tutorial-modal";

// type SendPhase = "idle" | "waiting" | "connecting" | "sending" | "reconnecting" | "done" | "error";
// type ReceivePhase = "idle" | "connecting" | "receiving" | "verifying" | "reconnecting" | "done" | "error";

// const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://getfasttransfer.app";
// const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];

// function waitForConfig(signaling: SignalingClient, fallback: number, timeoutMs: number): Promise<number> {
//   return waitForMessage(
//     signaling,
//     "CONFIG",
//     (msg) => (msg.payload as { connectionCount: number })?.connectionCount ?? fallback,
//     fallback,
//     timeoutMs,
//   );
// }

// // export default function HomePage() {
// //   const [turnOverride, setTurnOverride] = useState<TurnOverride | null>(null);

// //   return (
// //   <main className="relative min-h-screen w-full overflow-hidden  text-[#1a1a1a]">
// //       <div className="fixed inset-0 -z-10 pointer-events-none">
// //         <img
// //           src="/handdrawn-bg.png"
// //           alt=""
// //           draggable={false}
// //           className="h-full w-full object-cover"
// //         />
// //       </div>
// //       <div className="mx-auto max-w-5xl z-10">
// //         <header className="mb-8">
// //           <h1 className="text-3xl font-bold tracking-tight">
// //             fast-transfer<span className="text-muted">.</span>
// //           </h1>
// //           <p className="mt-1 text-sm text-muted">
// //             Direct browser-to-browser file transfer. Encrypted end-to-end. Nothing touches our servers.
// //           </p>
// //         </header>

// //         <div className="grid gap-6 border-none bg-transparent p-0 sm:grid-cols-2">
// //           <div className=" border-none sm:border-b-0 sm:border-r">
// //             <SendPanel turnOverride={turnOverride} />
// //           </div>
// //           <div className=" border-0">
// //             <ReceivePanel turnOverride={turnOverride} />
// //           </div>
// //         </div>

// //         {/* <div className="mt-4">
// //           <RelaySettings value={turnOverride} onChange={setTurnOverride} />
// //         </div> */}

// //         <footer className="mt-4 flex items-center justify-between text-[11px] text-muted">
// //           <span>Signaling only. Files travel peer-to-peer via WebRTC.</span>
// //           <span>
// //             {turnOverride ? "Custom TURN configured for this session." : "STUN only — no relay fallback by default."}
// //           </span>
// //         </footer>
// //       </div>
// //     </main> 
// //   );
// // }


// // Flying Butterfly Component
// function FlyingButterfly() {
//   const [key, setKey] = useState(0);
//   const [lastExitPoint, setLastExitPoint] = useState<{ x: number; y: number } | null>(null);
//   const [flightConfig, setFlightConfig] = useState<any>(null);

//   useEffect(() => {
//     // Helper to generate a random edge coordinate
//     const getRandomEdgeCoords = () => {
//       const edge = Math.floor(Math.random() * 4);
//       switch (edge) {
//         case 0: return { x: Math.random() * 80 + 10, y: -10 }; // Top
//         case 1: return { x: 110, y: Math.random() * 80 + 10 };  // Right
//         case 2: return { x: Math.random() * 80 + 10, y: 110 }; // Bottom
//         case 3: return { x: -10, y: Math.random() * 80 + 10 };  // Left
//         default: return { x: -10, y: -10 };
//       }
//     };

//     // 1. Entry point: Uses the last exit point if available; otherwise picks a random edge
//     const start = lastExitPoint || getRandomEdgeCoords();

//     // 2. Pick a new random exit edge (ensuring it's not starting and ending at the exact same spot)
//     let end = getRandomEdgeCoords();

//     // 3. Generate completely random wandering waypoints across the screen (not restricted to flowers)
//     const wanderSpot1 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };
//     const wanderSpot2 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };
//     const wanderSpot3 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };

//     // Save current exit point for the NEXT flight cycle
//     setLastExitPoint(end);

//     // Compute rotation angles towards each random point
//     const calcAngle = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
//       const radians = Math.atan2(p2.y - p1.y, p2.x - p1.x);
//       return Math.round((radians * 180) / Math.PI) + 90;
//     };

//     const angle1 = calcAngle(start, wanderSpot1);
//     const angle2 = calcAngle(wanderSpot1, wanderSpot2);
//     const angle3 = calcAngle(wanderSpot2, wanderSpot3);
//     const angle4 = calcAngle(wanderSpot3, end);

//     const duration = Math.floor(Math.random() * 6) + 18; // Smooth 18s - 24s flight path

//     setFlightConfig({
//       start,
//       end,
//       wanderSpot1,
//       wanderSpot2,
//       wanderSpot3,
//       angle1,
//       angle2,
//       angle3,
//       angle4,
//       duration,
//     });
//   }, [key]);

//   // Rest pause between flight cycles
//   const handleAnimationEnd = () => {
//     const pauseDelay = Math.floor(Math.random() * 6000) + 4000; // 4 to 10 seconds break
//     setTimeout(() => {
//       setKey((prev) => prev + 1);
//     }, pauseDelay);
//   };

//   if (!flightConfig) return null;

//   return (
//     <>
//       <style>{`
//         /* Dynamic wing flapping speed: Fast during flight, slow during resting pause */
//         @keyframes flapLeft {
//           0%, 100% { transform: scaleX(1); }
//           50% { transform: scaleX(0.15); }
//         }

//         @keyframes flapRight {
//           0%, 100% { transform: scaleX(1); }
//           50% { transform: scaleX(0.15); }
//         }

//         .butterfly-left-wing {
//           transform-origin: 20px 18px;
//           animation: flapLeft 0.18s ease-in-out infinite;
//         }

//         .butterfly-right-wing {
//           transform-origin: 20px 18px;
//           animation: flapRight 0.18s ease-in-out infinite;
//         }

//         /* Smooth wandering flight path with resting pauses */
//         @keyframes dynamicFlightPath_${key} {
//           0% {
//             top: ${flightConfig.start.y}%;
//             left: ${flightConfig.start.x}%;
//             transform: rotate(${flightConfig.angle1}deg) scale(0.85);
//           }
//           20% {
//             top: ${flightConfig.wanderSpot1.y}%;
//             left: ${flightConfig.wanderSpot1.x}%;
//             transform: rotate(${flightConfig.angle1}deg) scale(1);
//           }
//           /* Hover & pause at point 1 */
//           28% {
//             top: ${flightConfig.wanderSpot1.y + 1}%;
//             left: ${flightConfig.wanderSpot1.x - 1}%;
//             transform: rotate(${flightConfig.angle2 - 10}deg) scale(0.95);
//           }
//           48% {
//             top: ${flightConfig.wanderSpot2.y}%;
//             left: ${flightConfig.wanderSpot2.x}%;
//             transform: rotate(${flightConfig.angle2}deg) scale(0.9);
//           }
//           /* Gentle flutter pause at point 2 */
//           54% {
//             top: ${flightConfig.wanderSpot2.y - 2}%;
//             left: ${flightConfig.wanderSpot2.x + 1}%;
//             transform: rotate(${flightConfig.angle3 + 10}deg) scale(1);
//           }
//           75% {
//             top: ${flightConfig.wanderSpot3.y}%;
//             left: ${flightConfig.wanderSpot3.x}%;
//             transform: rotate(${flightConfig.angle3}deg) scale(0.95);
//           }
//           82% {
//             top: ${flightConfig.wanderSpot3.y + 1}%;
//             left: ${flightConfig.wanderSpot3.x + 2}%;
//             transform: rotate(${flightConfig.angle4}deg) scale(0.9);
//           }
//           100% {
//             top: ${flightConfig.end.y}%;
//             left: ${flightConfig.end.x}%;
//             transform: rotate(${flightConfig.angle4}deg) scale(0.8);
//           }
//         }

//         .dynamic-butterfly {
//           position: absolute;
//           z-index: 20;
//           pointer-events: none;
//           width: 36px;
//           height: 36px;
//           animation: dynamicFlightPath_${key} ${flightConfig.duration}s ease-in-out forwards;
//         }
//       `}</style>

//       {/* Rendered Butterfly */}
//       <div
//         key={key}
//         className="dynamic-butterfly"
//         onAnimationEnd={handleAnimationEnd}
//       >
//         <svg
//           width="36"
//           height="36"
//           viewBox="0 0 40 40"
//           fill="none"
//           xmlns="http://www.w3.org/2000/svg"
//         >
//           <defs>
//             <filter id="butterflyFilter" x="-10%" y="-10%" width="120%" height="120%">
//               <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
//               <feDisplacementMap in="SourceGraphic" in2="noise" scale="1" xChannelSelector="R" yChannelSelector="G" />
//             </filter>
//             <pattern id="wingPattern" width="3" height="3" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
//               <line x1="0" y1="0" x2="0" y2="3" stroke="#1c1c1e" strokeWidth="0.7" opacity="0.25" />
//             </pattern>
//           </defs>

//           <g filter="url(#butterflyFilter)">
//             {/* Left Wing */}
//             <g className="butterfly-left-wing">
//               <path d="M 20 18 C 10 3, 1 7, 3 16 C 5 22, 15 20, 20 18 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.6" />
//               <path d="M 18 17 C 11 7, 4 10, 6 16 C 8 19, 15 18, 18 17 Z" fill="url(#wingPattern)" stroke="#1c1c1e" strokeWidth="0.7" />
//               <path d="M 19 19 C 10 21, 5 27, 9 31 C 13 33, 18 25, 19 19 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.4" />
//             </g>

//             {/* Right Wing */}
//             <g className="butterfly-right-wing">
//               <path d="M 20 18 C 30 3, 39 7, 37 16 C 35 22, 25 20, 20 18 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.6" />
//               <path d="M 22 17 C 29 7, 36 10, 34 16 C 32 19, 25 18, 22 17 Z" fill="url(#wingPattern)" stroke="#1c1c1e" strokeWidth="0.7" />
//               <path d="M 21 19 C 30 21, 35 27, 31 31 C 27 33, 22 25, 21 19 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.4" />
//             </g>

//             {/* Body */}
//             <ellipse cx="20" cy="19" rx="1.2" ry="5.5" fill="#1c1c1e" />
//             <circle cx="20" cy="13" r="1" fill="#1c1c1e" />
//             <path d="M 20 13 C 18 9, 15 8, 13 9" stroke="#1c1c1e" strokeWidth="0.8" fill="none" />
//             <path d="M 20 13 C 22 9, 25 8, 27 9" stroke="#1c1c1e" strokeWidth="0.8" fill="none" />
//           </g>
//         </svg>
//       </div>
//     </>
//   );
// }
// const PaperAirplaneIcon = ({ size = 32 }: { size?: number }) => {
//   return (
//     <svg
//       width={size}
//       height={size}
//       viewBox="0 0 100 100"
//       style={{ overflow: "visible" }}
//       className="shrink-0"
//       aria-hidden="true"
//     >
//       <defs>
//         <filter
//           id="kimo-pencil-sketch"
//           x="-20%"
//           y="-20%"
//           width="140%"
//           height="140%"
//         >
//           <feTurbulence
//             type="fractalNoise"
//             baseFrequency="0.04"
//             numOctaves="3"
//             result="noise"
//           />

//           <feDisplacementMap
//             in="SourceGraphic"
//             in2="noise"
//             scale="2.5"
//             xChannelSelector="R"
//             yChannelSelector="G"
//           />

//           <feMorphology
//             operator="dilate"
//             radius="0.3"
//             in="SourceGraphic"
//           />
//         </filter>
//       </defs>

//       <g filter="url(#kimo-pencil-sketch)">
//         <g
//           stroke="#575656"
//           fill="none"
//           strokeLinecap="round"
//           strokeLinejoin="round"
//         >
//           {/* Top wing */}
//           <path
//             d="M30 46 L85 32"
//             strokeWidth="3"
//           />

//           {/* Main right wing */}
//           <path
//             d="M85 32 L60 72"
//             strokeWidth="3"
//           />

//           {/* Bottom wing fold */}
//           <path
//             d="M60 72 L42 54"
//             strokeWidth="2.5"
//           />

//           {/* Back edge */}
//           <path
//             d="M30 46 L42 54"
//             strokeWidth="3"
//           />

//           {/* Center spine */}
//           <path
//             d="M85 32 L42 54"
//             strokeWidth="2.5"
//           />

//           {/* Curved back flap */}
//           <path
//             d="M42 54 C40 64 46 68 50 63"
//             strokeWidth="2.5"
//           />

//           {/* Flight trail */}
//           <path
//             d="M26 74 L36 67"
//             strokeWidth="2.5"
//             strokeDasharray="4 4"
//           />
//         </g>
//       </g>
//     </svg>
//   );
// };

// export default function HomePage() {
//   const [turnOverride, setTurnOverride] = useState<TurnOverride | null>(null);
//   // Mobile only: which panel (Send/Receive) is currently shown. On sm+ screens
//   // both panels are shown side-by-side as before, this only matters below sm.
//   const [mobileView, setMobileView] = useState<"send" | "receive">("send");

//   // Hand-drawn "how this works" walkthrough. Opens from the header's help
//   // icon, and — optionally — once automatically for first-time visitors.
//   // Remove the useTutorialAutoOpen(...) line below if you only want the
//   // manual icon trigger.
//   const [tutorialOpen, setTutorialOpen] = useState(false);
//   useTutorialAutoOpen(setTutorialOpen);

//   return (
//     <main className="relative min-h-screen w-full overflow-hidden text-[#1a1a1a]">
//       {/* Background Image */}
//       <div className="fixed inset-0 -z-10 pointer-events-none">
//         <img
//           src="/handdrawn-bg.png"
//           alt=""
//           draggable={false}
//           className="h-full w-full object-cover"
//         />
//       </div>

//       {/* Dynamic Flying Butterfly Effect */}
//       <FlyingButterfly />

//       {/* Hand-drawn "how this works" walkthrough, opened from the help
//           icon in the header (see nav below). */}
//       <TutorialModal
//         open={tutorialOpen}
//         onClose={() => setTutorialOpen(false)}
//         mobileView={mobileView}
//         setMobileView={setMobileView}
//       />

//       <div className="mx-auto max-w-5xl z-10 relative pt-4 px-4 sm:px-6 lg:px-8">
//         <header className="mb-2 flex items-center justify-between gap-2">
//   {/* Left side: Logo + Text + Sparkle */}
//   <div className="flex items-center gap-1">
//     <span className="sm:hidden">
//       <PaperAirplaneIcon size={36} />
//     </span>
//     <span className="hidden sm:inline-flex">
//       <PaperAirplaneIcon size={52} />
//     </span>

//     <div className="flex items-center">
//       <span className="text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-[#595858]">
//         kimo
//       </span>

//       {/* Sparkle burst */}
//       <svg
//         width="22"
//         height="26"
//         viewBox="0 0 28 32"
//         fill="none"
//         className="ml-0.5 mt-1 shrink-0 sm:h-8 sm:w-7"
//         aria-hidden="true"
//       >
//         <path d="M 6 7 L 12 3" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//         <path d="M 11 12 L 18 9" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//         <path d="M 12 17 L 20 17" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//         <path d="M 11 22 L 18 25" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//         <path d="M 6 26 L 11 30" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//         <circle cx="23" cy="12" r="1" fill="#575656" />
//         <circle cx="22" cy="22" r="1" fill="#575656" />
//       </svg>
//     </div>
//   </div>

//   {/* Right side: Hand-drawn style navigation with dividers */}
//   <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3 text-[#575656]">
//     {/* Hand-Drawn Help (Tutorial trigger) Icon — opens the walkthrough modal */}
//     <button
//       type="button"
//       onClick={() => setTutorialOpen(true)}
//       className="transition-opacity hover:opacity-70"
//       aria-label="How kimo works"
//     >
//       <svg
//         className="h-4 w-4 sm:h-5 sm:w-5"
//         viewBox="0 0 24 24"
//         fill="none"
//         stroke="currentColor"
//         strokeWidth="2"
//         strokeLinecap="round"
//         strokeLinejoin="round"
//       >
//         {/* Hand-drawn wobbly circle */}
//         <path d="M12 3.3c4.9-.2 8.7 3.5 8.7 8.2s-3.9 8.6-8.8 8.5C7.2 20 3.4 16.4 3.4 11.7S7.1 3.5 12 3.3Z" />
//         {/* Hand-drawn question mark */}
//         <path d="M9.6 9.3c.3-1.6 1.7-2.6 3.3-2.4 1.5.2 2.6 1.4 2.5 2.8-.1 1.6-1.5 2.1-2.4 2.9-.6.6-.8 1.1-.8 1.9" />
//         <circle cx="12.1" cy="16.7" r="1" fill="currentColor" stroke="none" />
//       </svg>
//     </button>

//     {/* Hand-Drawn Bar Divider */}
//     <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
//       <path d="M 3 1.5 C 2.8 6, 3.2 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//     </svg>

//     {/* Open Book (Tutorials) Icon */}
//     <a
//       href="/blog"
//       className="transition-opacity hover:opacity-70"
//       aria-label="Blog / Info"
//     >
//       <svg
//         className="h-4 w-4 sm:h-5 sm:w-5"
//         viewBox="0 0 24 24"
//         fill="none"
//         stroke="currentColor"
//         strokeWidth="2"
//         strokeLinecap="round"
//         strokeLinejoin="round"
//       >
//         {/* Left page outline */}
//         <path d="M12 6.5C10 4.8 6.5 4.5 3 6v12.5c3.5-1.2 7-.9 9 .8" />
//         {/* Right page outline */}
//         <path d="M12 6.5C14 4.8 17.5 4.5 21 6v12.5c-3.5-1.2-7-.9-9 .8" />
//         {/* Book spine line */}
//         <path d="M12 6.5v12.8" />
//         {/* Text lines on left page */}
//         <path d="M5.5 9h4M5.5 12h4M5.5 15h3" strokeWidth="1.5" />
//         {/* Text lines on right page */}
//         <path d="M14.5 9h4M14.5 12h4M14.5 15h3" strokeWidth="1.5" />
//       </svg>
//     </a>

//     {/* Hand-Drawn Bar Divider */}
//     <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
//       <path d="M 3 1.5 C 2.8 6, 3.2 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//     </svg>

    

//     {/* Hand-Drawn Double-Line X (Twitter) Icon */}
//     <a
//       href="https://x.com/shivamdotdev"
//       target="_blank"
//       rel="noreferrer"
//       className="transition-opacity hover:opacity-70"
//       aria-label="X (Twitter)"
//     >
//       <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor">
//         <path d="M 18.2 3 L 21.5 3 L 14.3 11.2 L 22.8 21 L 16.2 21 L 11 14.2 L 5 21 L 1.7 21 L 9.4 12.2 L 1.2 3 L 8 3 L 12.7 9.2 L 18.2 3 Z M 17.1 19.5 L 18.9 19.5 L 7.1 4.4 L 5.1 4.4 L 17.1 19.5 Z" />
//       </svg>
//     </a>

//     {/* Hand-Drawn Bar Divider */}
//     <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
//       <path d="M 3 1.5 C 2.9 6, 3.1 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
//     </svg>

//     {/* Hand-Drawn Rounded Box "in" (LinkedIn) Icon */}
//     <a
//       href="https://www.linkedin.com/in/shivamdotdev"
//       target="_blank"
//       rel="noreferrer"
//       className="transition-opacity hover:opacity-70"
//       aria-label="LinkedIn"
//     >
//       <svg
//         className="h-5 w-5 sm:h-6 sm:w-6"
//         viewBox="0 0 24 24"
//         fill="none"
//         stroke="currentColor"
//         strokeWidth="2"
//         strokeLinecap="round"
//         strokeLinejoin="round"
//       >
//         {/* Hand-drawn rounded square frame */}
//         <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
//         {/* 'i' dot */}
//         <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
//         {/* 'i' stem */}
//         <path d="M8 11v6" strokeWidth="2" />
//         {/* 'n' stem and arch */}
//         <path d="M12.5 11v6" strokeWidth="2" />
//         <path d="M12.5 13.8c0-1.5 1-2.3 2.2-2.3s2.3.8 2.3 2.3V17" strokeWidth="2" />
//       </svg>
//     </a>
//   </nav>
// </header>

// {/* Hand-Drawn Pencil Divider (Ultra-thin & light taper) */}
// <div className="mb-5 w-full overflow-hidden" aria-hidden="true">
//   <svg
//     viewBox="0 0 1000 10"
//     fill="none"
//     preserveAspectRatio="none"
//     className="h-2 w-full"
//   >
//     {/* Very light & delicate single pencil line tapered from ~0.4px ends to ~1.4px center */}
//     <path
//       d="M 5 5 C 250 4.2, 750 5.8, 995 5"
//       fill="none"
//       stroke="#575656"
//       strokeWidth="1.2"
//       strokeLinecap="round"
//       opacity="0.35"
//     />
//   </svg>
// </div>


// <div className="mx-auto max-w-5xl mb-3">
//   {/* Mobile-only Send/Receive toggle — replaces the stacked layout below sm */}
//   <MobileViewToggle view={mobileView} setView={setMobileView} />

//   {/* Set a min-height or fixed height so the panel has space to push buttons down */}
//   {/* grid-cols-1 (== repeat(1, minmax(0,1fr))) is required below sm: without it,
//       an implicit auto-sized grid track is used, which is allowed to grow past
//       the container's width to fit any long unwrapped content inside (the
//       browser link, the code chip, etc.) — that's what was dragging the whole
//       column, and every full-width row inside it, off the right edge of the
//       screen on mobile. */}
// <div className="relative grid min-h-[calc(100vh-180px)] grid-cols-1 sm:min-h-[650px] items-stretch gap-6 sm:gap-8 border-none bg-transparent p-0 sm:grid-cols-2">
  
//   {/* Left Column Container (Send) */}
//   <div
//     className={`min-w-0 flex-1 flex-col justify-between sm:pr-6 ${
//       mobileView === "send" ? "flex" : "hidden"
//     } sm:flex`}
//   >
//     <SendPanel turnOverride={turnOverride} />
//   </div>

//   {/* Center Divider Line */}
//   <div
//     className="absolute inset-y-0 left-1/2 hidden -translate-x-1/2 sm:block"
//     aria-hidden="true"
//   >
//     <svg
//       viewBox="0 0 10 100"
//       preserveAspectRatio="none"
//       className="h-full w-2"
//     >
//       <path
//         d="M 5 1 C 4.2 25, 5.8 75, 5 99"
//         stroke="#575656"
//         strokeWidth="1.2"
//         strokeLinecap="round"
//         opacity="0.35"
//       />
//     </svg>
//   </div>

//   {/* Right Column Container (Receive) */}
//   <div
//     className={`min-w-0 flex-1 flex-col justify-between sm:pl-6 ${
//       mobileView === "receive" ? "flex" : "hidden"
//     } sm:flex`}
//   >
//     <ReceivePanel turnOverride={turnOverride} />
//   </div>

// </div>
// </div>

//         {/* <footer className="mt-4 flex items-center justify-between text-[11px] text-muted">
//           <span>Signaling only. Files travel peer-to-peer via WebRTC.</span>
//           <span>
//             {turnOverride ? "Custom TURN configured for this session." : "STUN only — no relay fallback by default."}
//           </span>
//         </footer> */}

        
//       </div>
//     </main>
//   );
// }

// interface ModeTabsProps {
//   storeMode: boolean;
//   setStoreMode: (mode: boolean) => void;
//   disabled?: boolean;
// }

// interface MobileViewToggleProps {
//   view: "send" | "receive";
//   setView: (view: "send" | "receive") => void;
// }

// // Small-screen only segmented control that swaps between the Send and
// // Receive panels instead of stacking them top/bottom. Both panels stay
// // mounted (just hidden via CSS) so in-progress transfers are never reset
// // by switching tabs. Hidden entirely at sm+ where the two-column layout
// // already shows both panels side by side.
// function MobileViewToggle({ view, setView }: MobileViewToggleProps) {
//   return (
//     <div className="mb-4 w-full sm:hidden" data-tour="mobile-toggle">
//       <div className="flex h-11 w-full overflow-hidden rounded-md border-2 border-[#dcdbdb] bg-transparent">
//         <button
//           type="button"
//           onClick={() => setView("send")}
//           className={`relative flex flex-1 items-center justify-center gap-1.5 text-sm font-bold transition-all cursor-pointer ${
//             view !== "send" ? "text-[#101010] hover:bg-[#101010]/5" : "text-white"
//           }`}
//         >
//           {view === "send" && (
//             <div
//               className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//               style={{ filter: "url(#pencil-rough)" }}
//             >
//               <PencilTextureCanvas />
//             </div>
//           )}
//           <span
//             className="relative z-10 flex items-center gap-1.5"
//             style={
//               view === "send"
//                 ? {
//                     textShadow:
//                       "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
//                   }
//                 : undefined
//             }
//           >
//             <UploadIcon color={view === "send" ? "#fff" : "#3B3B3C"} /> Send
//           </span>
//         </button>

//         <button
//           type="button"
//           onClick={() => setView("receive")}
//           className={`relative flex flex-1 items-center justify-center gap-1.5 text-sm font-bold transition-all cursor-pointer ${
//             view !== "receive" ? "text-[#101010] hover:bg-[#101010]/5" : "text-white"
//           }`}
//         >
//           {view === "receive" && (
//             <div
//               className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//               style={{ filter: "url(#pencil-rough)" }}
//             >
//               <PencilTextureCanvas />
//             </div>
//           )}
//           <span
//             className="relative z-10 flex items-center gap-1.5"
//             style={
//               view === "receive"
//                 ? {
//                     textShadow:
//                       "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
//                   }
//                 : undefined
//             }
//           >
//             <DownloadIcon color={view === "receive" ? "#fff" : "#3B3B3C"} /> Receive
//           </span>
//         </button>
//       </div>
//     </div>
//   );
// }

// function PencilTextureCanvas() {
//   const canvasRef = useRef<HTMLCanvasElement>(null);

//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//     const ctx = canvas.getContext("2d");
//     if (!ctx) return;

//     const w = canvas.width;
//     const h = canvas.height;

//     ctx.clearRect(0, 0, w, h);

//     // 1. Light off-white base paper layer
//     ctx.fillStyle = "#dedcd5";
//     ctx.fillRect(0, 0, w, h);

//     // 2. Heavy diagonal pencil shading pass 1 (dark gray/black)
//     ctx.strokeStyle = "#1e1e1e";
//     for (let x = -h; x < w + h; x += 3.5) {
//       ctx.lineWidth = 1.2 + Math.random() * 1.5;
//       ctx.globalAlpha = 0.6 + Math.random() * 0.35;
//       ctx.beginPath();
//       ctx.moveTo(x + (Math.random() * 2 - 1), 0);
//       ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
//       ctx.stroke();
//     }

//     // 3. Dense cross-hatching pass 2 (medium graphite)
//     ctx.strokeStyle = "#383838";
//     for (let x = -h; x < w + h; x += 4) {
//       ctx.lineWidth = 1 + Math.random() * 1.2;
//       ctx.globalAlpha = 0.4 + Math.random() * 0.3;
//       ctx.beginPath();
//       ctx.moveTo(x + h, 0);
//       ctx.lineTo(x, h);
//       ctx.stroke();
//     }

//     // 4. Dark smudge patches along the edges
//     ctx.fillStyle = "#121212";
//     for (let i = 0; i < 40; i++) {
//       ctx.globalAlpha = 0.15 + Math.random() * 0.25;
//       const rx = Math.random() * w;
//       const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
//       ctx.beginPath();
//       ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
//       ctx.fill();
//     }

//     // 5. Hand-drawn outer border
//     ctx.globalAlpha = 0.9;
//     ctx.strokeStyle = "#101010";
//     ctx.lineWidth = 2.5;
//     ctx.beginPath();
//     ctx.roundRect(2, 2, w - 4, h - 4, 6);
//     ctx.stroke();

//     // 6. Inner sketch outline
//     ctx.lineWidth = 1;
//     ctx.globalAlpha = 0.7;
//     ctx.beginPath();
//     ctx.roundRect(5, 5, w - 10, h - 10, 4);
//     ctx.stroke();

//     // 7. Corner 'X' registration marks
//     const drawX = (cx: number, cy: number) => {
//       ctx.lineWidth = 1.2;
//       ctx.globalAlpha = 0.85;
//       ctx.beginPath();
//       ctx.moveTo(cx - 3, cy - 3);
//       ctx.lineTo(cx + 3, cy + 3);
//       ctx.moveTo(cx + 3, cy - 3);
//       ctx.lineTo(cx - 3, cy + 3);
//       ctx.stroke();
//     };
//     drawX(10, 10);
//     drawX(w - 10, 10);
//     drawX(10, h - 10);
//     drawX(w - 10, h - 10);
//   }, []);

//   return (
//     <canvas
//       ref={canvasRef}
//       width={240}
//       height={40}
//       className="absolute inset-0 h-full w-full rounded-[6px]"
//     />
//   );
// }

// function ModeTabs({ storeMode, setStoreMode, disabled }: ModeTabsProps) {
//   return (
//     <div className="mb-3 w-full">
//       {/* Rough edge displacement filter */}
//       <svg className="absolute h-0 w-0" aria-hidden="true">
//         <defs>
//           <filter id="pencil-rough">
//             <feTurbulence
//               type="fractalNoise"
//               baseFrequency="0.08"
//               numOctaves="2"
//               result="noise"
//             />
//             <feDisplacementMap
//               in="SourceGraphic"
//               in2="noise"
//               scale="1.8"
//               xChannelSelector="R"
//               yChannelSelector="G"
//             />
//           </filter>
//         </defs>
//       </svg>

//       {/* Segmented Outer Shell */}
//       <div className="flex h-11 w-full overflow-visible rounded-md border-2 border-[#dcdbdb] bg-transparent">
//         {/* Direct Button */}
//         <button
//           type="button"
//           disabled={disabled}
//           onClick={() => setStoreMode(false)}
//           className={`relative flex flex-1 items-center justify-center text-sm font-bold transition-all ${
//             disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
//           } ${!storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
//         >
//           {!storeMode && (
//             <div
//               className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//               style={{ filter: "url(#pencil-rough)" }}
//             >
//               <PencilTextureCanvas />
//             </div>
//           )}
//           <span
//             className="relative z-10"
//             style={
//               !storeMode
//                 ? {
//                     textShadow:
//                       "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
//                   }
//                 : undefined
//             }
//           >
//             Direct
//           </span>
//         </button>

// <button
//   type="button"
//   disabled={disabled}
//   onClick={() => setStoreMode(true)}
//   className={`relative flex flex-1 items-center justify-center overflow-visible text-sm font-bold transition-all ${
//     disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
//   } ${storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
// >
// {/* Sitting Character - Shifted Right */}
// <img
//   src="/sitting-character.png"
//   alt=""
//   draggable={false}
//   className="pointer-events-none absolute -top-[72px] left-[90%] z-20 h-28 w-auto -translate-x-1/2 select-none sm:hidden"
// />

//   {storeMode && (
//     <div
//       className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//       style={{ filter: "url(#pencil-rough)" }}
//     >
//       <PencilTextureCanvas />
//     </div>
//   )}

//   <span
//     className="relative z-10"
//     style={
//       storeMode
//         ? {
//             textShadow:
//               "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
//           }
//         : undefined
//     }
//   >
//     Store for 1 day
//   </span>
// </button>
//       </div>
//     </div>
//   );
// }

// interface SketchedBackgroundProps {
//   mode?: "light" | "dark" | "outline";
//   className?: string;
// }

// function SketchedBackground({ mode = "light", className = "" }: SketchedBackgroundProps) {
//   const canvasRef = useRef<HTMLCanvasElement>(null);

//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//     const ctx = canvas.getContext("2d");
//     if (!ctx) return;

//     // Redraws the sketch texture at the canvas's *current* rendered box size.
//     // Re-running this on resize (not just on mount / mode change) is what
//     // keeps the border and corner registration marks pixel-accurate — if the
//     // box's width changes after the initial paint (e.g. a layout reflow, an
//     // orientation change, or a viewport resize) without this, the old
//     // fixed-resolution texture gets stretched by the browser to fill the new
//     // box size, which is what made the corner marks appear to drift outside
//     // the button edge.
//     const draw = () => {
//       const rect = canvas.getBoundingClientRect();
//       const w = (canvas.width = rect.width || 460);
//       const h = (canvas.height = rect.height || 48);

//       ctx.clearRect(0, 0, w, h);

//       if (mode === "dark") {
//       // Dark Active State
//       ctx.fillStyle = "#121212";
//       ctx.fillRect(0, 0, w, h);

//       ctx.strokeStyle = "#000000";
//       for (let x = -h; x < w + h; x += 3) {
//         ctx.lineWidth = 1.2 + Math.random();
//         ctx.globalAlpha = 0.8;
//         ctx.beginPath();
//         ctx.moveTo(x, 0);
//         ctx.lineTo(x + h, h);
//         ctx.stroke();
//       }

//       ctx.fillStyle = "#000000";
//       for (let i = 0; i < 35; i++) {
//         ctx.globalAlpha = 0.35;
//         const rx = Math.random() * w;
//         const ry = Math.random() * h;
//         ctx.beginPath();
//         ctx.arc(rx, ry, 3 + Math.random() * 5, 0, Math.PI * 2);
//         ctx.fill();
//       }
//     } else if (mode === "light") {
//       // Idle State (Exact snippet provided)
//       ctx.fillStyle = "#dedcd5";
//       ctx.fillRect(0, 0, w, h);

//       ctx.strokeStyle = "#1e1e1e";
//       for (let x = -h; x < w + h; x += 3.5) {
//         ctx.lineWidth = 1.2 + Math.random() * 1.5;
//         ctx.globalAlpha = 0.6 + Math.random() * 0.35;
//         ctx.beginPath();
//         ctx.moveTo(x + (Math.random() * 2 - 1), 0);
//         ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
//         ctx.stroke();
//       }

//       ctx.strokeStyle = "#383838";
//       for (let x = -h; x < w + h; x += 4) {
//         ctx.lineWidth = 1 + Math.random() * 1.2;
//         ctx.globalAlpha = 0.4 + Math.random() * 0.3;
//         ctx.beginPath();
//         ctx.moveTo(x + h, 0);
//         ctx.lineTo(x, h);
//         ctx.stroke();
//       }

//       ctx.fillStyle = "#121212";
//       for (let i = 0; i < 40; i++) {
//         ctx.globalAlpha = 0.15 + Math.random() * 0.25;
//         const rx = Math.random() * w;
//         const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
//         ctx.beginPath();
//         ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
//         ctx.fill();
//       }
//     }

//     // Outer & Inner borders
//     ctx.globalAlpha = 0.9;
//     ctx.strokeStyle = "#101010";
//     ctx.lineWidth = 2.5;
//     ctx.beginPath();
//     ctx.roundRect(2, 2, w - 4, h - 4, 6);
//     ctx.stroke();

//     ctx.lineWidth = 1;
//     ctx.globalAlpha = 0.7;
//     ctx.beginPath();
//     ctx.roundRect(5, 5, w - 10, h - 10, 4);
//     ctx.stroke();

//     // Registration Marks
//     const drawX = (cx: number, cy: number) => {
//       ctx.lineWidth = 1.2;
//       ctx.globalAlpha = 0.85;
//       ctx.beginPath();
//       ctx.moveTo(cx - 3, cy - 3);
//       ctx.lineTo(cx + 3, cy + 3);
//       ctx.moveTo(cx + 3, cy - 3);
//       ctx.lineTo(cx - 3, cy + 3);
//       ctx.stroke();
//     };
//     drawX(10, 10);
//     drawX(w - 10, 10);
//     drawX(10, h - 10);
//     drawX(w - 10, h - 10);
//     };

//     draw();

//     const observer = new ResizeObserver(() => draw());
//     observer.observe(canvas);
//     return () => observer.disconnect();
//   }, [mode]);

//   return (
//     <canvas
//       ref={canvasRef}
//       className={`absolute inset-0 h-full w-full pointer-events-none rounded-[6px] ${className}`}
//     />
//   );
// }

// // ---------------------------------------------------------------------------
// // Send panel
// // ---------------------------------------------------------------------------

// function SendPanel({ turnOverride }: { turnOverride: TurnOverride | null }) {
//   const [files, setFiles] = useState<File[]>([]);
//   const [phase, setPhase] = useState<SendPhase>("idle");
//   const [code, setCode] = useState<string | null>(null);
//   const [error, setError] = useState<string | null>(null);
//   const [parallelMode, setParallelMode] = useState(false);
//   const [storeMode, setStoreMode] = useState(false);
//   const [storePhase, setStorePhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
//   const [storeProgress, setStoreProgress] = useState<StoreUploadProgress | null>(null);
//   const [storeResult, setStoreResult] = useState<{ shareUrl: string; revokeToken: string; id: string } | null>(
//     null,
//   );
//   const [progress, setProgress] = useState<Progress | null>(null);
//   const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
//     type: "unknown",
//     rttMs: null,
//   });

//   const signalingRef = useRef<SignalingClient | null>(null);
//   const peersRef = useRef<PeerConnection[]>([]);
//   const channelsRef = useRef<RTCDataChannel[]>([]);
//   const statsRef = useRef<StatsMonitor | null>(null);
//   const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
//     start: 0,
//     end: 0,
//     peakBps: 0,
//   });
//   // Resume checkpoint: how far we got before a drop, so a reconnect can
//   // continue with only the remaining files instead of restarting the batch
//   // (PRD §21). bytesAlreadySent is an *estimate* used only for progress
//   // display continuity — the chunk-level resume protocol in sendFiles is
//   // what actually guarantees correctness, this just keeps the bar honest.
//   const resumeRef = useRef<{
//     remainingFiles: File[];
//     bytesAlreadySent: number;
//     totalFiles: number;
//     totalBytes: number;
//   } | null>(null);
//   const reconnectAttemptRef = useRef(0);
//   const terminalRef = useRef(false); // set once done/error/cancelled, so a late connection-state event or in-flight callback doesn't trigger a pointless reconnect or overwrite the UI after the user already left
//   const abortControllerRef = useRef<AbortController | null>(null); // lets us stop an in-flight sendFiles() promptly on cancel instead of it hanging or resolving late
//   const phaseRef = useRef<SendPhase>("idle"); // mirrors `phase` for use inside stable callbacks (e.g. the signaling close handler) that shouldn't go stale

//   useEffect(() => {
//     phaseRef.current = phase;
//   }, [phase]);

//   const cleanup = useCallback(() => {
//     statsRef.current?.stop();
//     peersRef.current.forEach((p) => p.close());
//     signalingRef.current?.close();
//     statsRef.current = null;
//     peersRef.current = [];
//     channelsRef.current = [];
//     signalingRef.current = null;
//   }, []);

//   useEffect(() => cleanup, [cleanup]);

//   const startSend = async () => {
//     if (files.length === 0) return;
//     setError(null);
//     setPhase("waiting");
//     reconnectAttemptRef.current = 0;
//     terminalRef.current = false;
//     abortControllerRef.current = new AbortController();
//     const totalBytes = files.reduce((s, f) => s + f.size, 0);
//     resumeRef.current = {
//       remainingFiles: files,
//       bytesAlreadySent: 0,
//       totalFiles: files.length,
//       totalBytes,
//     };
//     // Auto-scale connection count by size instead of relying only on the
//     // manual checkbox — the checkbox still forces it on for small files.
//     setParallelMode((prev) => prev || chooseConnectionCount(totalBytes) > 1);

//     try {
//       const room = await createRoom();
//       setCode(room.code);

//       let signaling = new SignalingClient(room.code, "sender");
//       signalingRef.current = signaling;
//       await signaling.connect();

//       const attachTopLevelHandlers = (client: SignalingClient) => {
//         client.onMessage((msg) => {
//           if (msg.type === "PEER_JOINED") {
//             void establishAndRun();
//           }
//           if (msg.type === "PEER_LEFT") {
//             terminalRef.current = true;
//             setError("The receiver disconnected.");
//             setPhase("error");
//           }
//         });
//         // The signaling WebSocket can die silently while we're just sitting
//         // on the "waiting for recipient" screen (idle connections get
//         // dropped by proxies/NATs without a close frame) — this is what
//         // made "click send, wait a bit, then have the receiver enter the
//         // code" fail with no explanation. Only auto-recover here while we
//         // haven't paired yet; once WebRTC takes over, a dead peer
//         // connection is handled by onConnectionStateChange below instead.
//         client.onClose(() => {
//           if (terminalRef.current) return;
//           if (phaseRef.current !== "waiting") return;
//           void attemptReconnect();
//         });
//       };

//       const runTransfer = (channels: RTCDataChannel[], primaryPeer: PeerConnection) => {
//         setPhase("sending");
//         channelsRef.current = channels;
//         if (timingRef.current.start === 0) {
//           timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
//         }

//         statsRef.current?.stop();
//         const stats = new StatsMonitor(
//           () => primaryPeer.getStats(),
//           (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
//         );
//         stats.start();
//         statsRef.current = stats;

//         const checkpoint = resumeRef.current!;
//         // The real, per-connection negotiated SCTP limit — take the
//         // minimum across every connection in use (parallel mode can have
//         // more than one) so no single connection's chunk gets rejected.
//         // This is the actual fix for "Trying to send message larger than
//         // max-message-size" — see resolveChunkSize in transfer.ts.
//         const maxMessageSize = peersRef.current.reduce<number | null>((min, p) => {
//           const size = p.getMaxMessageSize();
//           if (size == null) return min;
//           return min == null ? size : Math.min(min, size);
//         }, null);
//         void sendFiles(
//           channels,
//           checkpoint.remainingFiles,
//           {
//             onProgress: (p) => {
//               if (terminalRef.current) return; // cancelled/finished already — don't resurrect a stale progress bar
//               setProgress(p);
//               timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
//             },
//             onFileFullySent: () => {
//               // Drop the file that just finished — whatever's left is what
//               // a reconnect would need to send.
//               checkpoint.bytesAlreadySent += checkpoint.remainingFiles[0].size;
//               checkpoint.remainingFiles = checkpoint.remainingFiles.slice(1);
//             },
//             onAllComplete: () => {
//               if (terminalRef.current) return;
//               terminalRef.current = true;
//               timingRef.current.end = performance.now();
//               setPhase("done");
//             },
//             onError: (msg) => {
//               // cancel() already flips terminalRef + phase synchronously —
//               // this callback firing afterwards (the abort unwinding through
//               // sendFiles' catch block) must not clobber that with an
//               // "error" state appearing after the fact. That's what made
//               // Cancel feel broken: the button worked immediately, but a
//               // stray late error overwrote the UI a moment later.
//               if (terminalRef.current) return;
//               terminalRef.current = true;
//               setError(msg);
//               setPhase("error");
//             },
//           },
//           {
//             totalFiles: checkpoint.totalFiles,
//             totalBytes: checkpoint.totalBytes,
//             bytesAlreadySent: checkpoint.bytesAlreadySent,
//           },
//           maxMessageSize,
//           abortControllerRef.current?.signal,
//         );
//       };

//       const establishAndRun = async () => {
//         setPhase("connecting");

//         // Tell the receiver exactly how many RTCPeerConnections to expect,
//         // so it doesn't have to eagerly open MAX_PARALLEL_CONNECTIONS and
//         // prune the unused ones (see multi-peer.ts / README "Known
//         // limitations" — this closes that gap).
//         const connectionCount = parallelMode
//           ? MAX_PARALLEL_CONNECTIONS
//           : chooseConnectionCount(resumeRef.current!.totalBytes);
//         signaling.send({
//           type: "CONFIG",
//           role: "sender",
//           payload: { connectionCount },
//         });

//         const onConnectionStateChange = (state: RTCPeerConnectionState) => {
//           if (state !== "failed" && state !== "disconnected") return;
//           if (terminalRef.current) return; // already done/errored — nothing to resume
//           const remaining = resumeRef.current?.remainingFiles.length ?? 0;
//           if (remaining === 0) return; // already finished — nothing to resume
//           void attemptReconnect();
//         };

//         if (connectionCount > 1) {
//           const { peers, channels } = await establishParallelSenderConnections(
//             signaling,
//             connectionCount,
//             { onConnectionStateChange },
//             undefined,
//             getIceServers(turnOverride),
//           );
//           peersRef.current = peers;
//           if (channels.length === 0) {
//             terminalRef.current = true;
//             setError("Failed to establish any parallel connection.");
//             setPhase("error");
//             return;
//           }
//           runTransfer(channels, peers[0]);
//         } else {
//           const peer = new PeerConnection(
//             "sender",
//             signaling,
//             {
//               onDataChannelOpen: (channel) => runTransfer([channel], peer),
//               onConnectionStateChange,
//             },
//             undefined,
//             getIceServers(turnOverride),
//           );
//           peersRef.current = [peer];
//           void peer.initiate();
//         }
//       };

//       const attemptReconnect = async () => {
//         if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
//           terminalRef.current = true;
//           setError("Connection lost and could not be re-established.");
//           setPhase("error");
//           return;
//         }
//         const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
//         reconnectAttemptRef.current++;
//         setPhase("reconnecting");
//         statsRef.current?.stop();
//         peersRef.current.forEach((p) => p.close());
//         peersRef.current = [];
//         await new Promise((r) => setTimeout(r, delay));

//         // Full signaling-reconnect: if the WebSocket itself also dropped
//         // (not just the RTCPeerConnection — a Wi-Fi hiccup or brief NAT
//         // rebinding usually only kills the latter), rebuild it against the
//         // same room. The room (and its code) outlives a single socket
//         // disconnect on the Durable Object side — see room.ts — so this is
//         // safe to retry as long as the room hasn't hit its own TTL.
//         if (!signaling.isConnected()) {
//           signaling.close();
//           signaling = new SignalingClient(room.code, "sender");
//           signalingRef.current = signaling;
//           try {
//             await signaling.connect();
//           } catch {
//             terminalRef.current = true;
//             setError("Lost connection to the pairing server and could not reconnect.");
//             setPhase("error");
//             return;
//           }
//           attachTopLevelHandlers(signaling);
//           // Don't call establishAndRun() directly here — the room's
//           // Durable Object only sends PEER_JOINED once it can confirm the
//           // receiver's socket is also present (room.ts's
//           // handleWebSocketUpgrade). If the receiver is already connected,
//           // that PEER_JOINED arrives immediately and attachTopLevelHandlers
//           // (just re-registered above) picks it up and calls
//           // establishAndRun for us. If the receiver is *also* mid-reconnect,
//           // this just waits for their socket to show up — trying to
//           // establish a WebRTC offer before the room can confirm a
//           // receiver is listening would silently go nowhere.
//           setPhase("waiting");
//           return;
//         }

//         void establishAndRun();
//       };

//       attachTopLevelHandlers(signaling);
//     } catch (err) {
//       terminalRef.current = true;
//       setError(err instanceof Error ? err.message : "Failed to start transfer");
//       setPhase("error");
//     }
//   };

//   const cancel = () => {
//     // Order matters: flip terminalRef *before* aborting/cleaning up, so any
//     // callback still unwinding from the in-flight sendFiles() promise sees
//     // it and no-ops instead of overwriting the UI a moment later (that
//     // delayed-looking "cancel didn't do anything, then something changes"
//     // behavior was exactly this ordering bug).
//     terminalRef.current = true;
//     abortControllerRef.current?.abort();
//     // Best-effort: tell the receiver right away instead of letting them
//     // sit there until their own stall timeout fires.
//     if (channelsRef.current[0]?.readyState === "open") {
//       try {
//         channelsRef.current[0].send(
//           JSON.stringify({ type: "CANCEL", reason: "The sender cancelled the transfer." }),
//         );
//       } catch {
//         // best effort only
//       }
//     }
//     cleanup();
//     setPhase("idle");
//     setCode(null);
//     setProgress(null);
//   };

//   const startStoreSend = async () => {
//     if (files.length === 0) return;
//     setError(null);
//     setStorePhase("uploading");
//     setStoreResult(null);
//     try {
//       const result = await uploadStored(
//         files,
//         { maxDownloads: 1, ttlMs: STORED_TRANSFER_DEFAULT_TTL_MS, appUrl: APP_URL },
//         (p) => setStoreProgress(p),
//       );
//       setStoreResult(result);
//       setStorePhase("done");
//     } catch (err) {
//       setError(err instanceof Error ? err.message : "Failed to upload");
//       setStorePhase("error");
//     }
//   };

//   const revokeStoreSend = async () => {
//     if (!storeResult) return;
//     await revokeStored(storeResult.id, storeResult.revokeToken).catch(() => {});
//     setStorePhase("idle");
//     setStoreResult(null);
//     setStoreProgress(null);
//     setFiles([]);
//   };

//   const isLocked = phase !== "idle";
//   const isStoreLocked = storePhase !== "idle";

// return (
//   <div className="flex h-full flex-col justify-between" data-tour="send-panel">
//     {/* TOP CONTENT WRAPPER */}
//     <div className="flex-1">
//       <div className="mb-4 flex items-center gap-3">
//         <IconBox>
//           <UploadIcon />
//         </IconBox>
//         <div className="mt-2 flex flex-col justify-center leading-snug">
//           <h2 className="mb-2 ml-2 text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem]">
//             Send
//           </h2>
//           <p className="ml-2 text-xs font-medium text-[#555555] leading-snug">
//             Choose several files. Share one code.
//           </p>
//         </div>
//       </div>

//       {/* Direct / Store tabs */}
//       <ModeTabs
//         storeMode={storeMode}
//         setStoreMode={setStoreMode}
//         disabled={isLocked || isStoreLocked}
//       />

//       {storeMode && (
//         <p className="mb-3 text-[11px] text-muted">
//           Encrypted on your device before upload. We only ever store ciphertext. Single download,
//           expires in 24h, or revoke it early below.
//         </p>
//       )}

//       <label className={`mb-4 flex items-center gap-2 text-[11px] text-muted ${storeMode ? "hidden" : ""}`}>
//         <input
//           type="checkbox"
//           checked={parallelMode}
//           disabled={isLocked}
//           onChange={(e) => setParallelMode(e.target.checked)}
//           className="h-3.5 w-3.5 accent-ink"
//         />
//         Parallel connections ({MAX_PARALLEL_CONNECTIONS}x, experimental) — benchmark this against
//         Direct before trusting it on your network
//       </label>

//       <div data-tour="file-dropzone">
//         <FileDropzone
//           files={files}
//           disabled={isLocked || isStoreLocked}
//           onFilesSelected={setFiles}
//           onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
//         />
//       </div>

//       <div data-tour="code-area">
//       {!storeMode && (
//         <>
//           {code && phase !== "idle" && (
//             <div className="mt-4">
//               <CodeDisplay code={code} browserLink={`${APP_URL}/?code=${code}`} />
//             </div>
//           )}

//           {phase === "waiting" && (
//             <div className="mt-4">
//               <p className="mb-2 text-xs text-muted">Waiting for recipient…</p>
//               <IndeterminateBar />
//             </div>
//           )}

//           {phase === "connecting" && (
//             <div className="mt-4">
//               <p className="mb-2 text-xs text-muted">Opening encrypted data channels…</p>
//               <IndeterminateBar />
//             </div>
//           )}

//           {phase === "sending" && progress && (
//             <div className="mt-4 space-y-3">
//               <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
//               <TransferProgress
//                 label="Sending"
//                 fileName={progress.fileName}
//                 bytesTransferred={progress.bytesTransferred}
//                 totalBytes={progress.totalBytes}
//                 percent={(progress.bytesTransferred / progress.totalBytes) * 100}
//                 ratePerSec={progress.ratePerSec}
//                 etaSeconds={progress.etaSeconds}
//                 fileIndex={progress.fileIndex}
//                 totalFiles={progress.totalFiles}
//                 windowBytes={progress.windowBytes}
//               />
//             </div>
//           )}

//           {phase === "reconnecting" && (
//             <div className="mt-4 space-y-2">
//               <p className="text-xs font-medium text-warn">
//                 Connection dropped — attempting to reconnect and resume…
//               </p>
//               <IndeterminateBar />
//               {progress && (
//                 <p className="text-[11px] text-muted">
//                   {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already sent —
//                   resuming from there, not from zero.
//                 </p>
//               )}
//             </div>
//           )}

//           {phase === "done" && (
//             <div className="mt-4 space-y-3">
//               <p className="text-xs font-medium text-accent">
//                 ✓ Transfer complete — {formatBytes(files.reduce((s, f) => s + f.size, 0))} sent.
//               </p>
//               <BenchmarkSummary
//                 totalBytes={files.reduce((s, f) => s + f.size, 0)}
//                 durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
//                 avgBytesPerSec={
//                   files.reduce((s, f) => s + f.size, 0) /
//                   ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
//                 }
//                 peakBytesPerSec={timingRef.current.peakBps}
//                 connectionType={connStats.type}
//                 rttMs={connStats.rttMs}
//                 finalWindowBytes={progress?.windowBytes}
//               />
//             </div>
//           )}

//           {phase === "error" && error && (
//             <p className="mt-4 text-xs font-medium text-warn">{error}</p>
//           )}
//         </>
//       )}
//       </div>

//       {storeMode && (
//         <>
//           {storePhase === "uploading" && storeProgress && (
//             <div className="mt-4 space-y-2">
//               <p className="text-xs text-muted">Encrypting and uploading…</p>
//               <div className="progress-track">
//                 <div
//                   className="progress-fill"
//                   style={{ width: `${Math.min(100, (storeProgress.bytesUploaded / storeProgress.totalBytes) * 100)}%` }}
//                 />
//               </div>
//               <p className="text-[11px] text-muted">
//                 {formatBytes(storeProgress.bytesUploaded)} / {formatBytes(storeProgress.totalBytes)}
//               </p>
//             </div>
//           )}

//           {storePhase === "done" && storeResult && (
//             <div className="mt-4 space-y-3">
//               <p className="text-xs font-medium text-accent">✓ Uploaded — ciphertext only, key never left your device.</p>
//               <CodeDisplay code={storeResult.shareUrl.split("#")[0].split("/").pop() ?? ""} browserLink={storeResult.shareUrl} />
//               <p className="text-[11px] text-muted">
//                 Single download, expires in 24h. Whoever opens this link can decrypt it — share it privately.
//               </p>
//               <button type="button" onClick={revokeStoreSend} className="btn-secondary border-warn text-warn">
//                 Revoke now
//               </button>
//             </div>
//           )}

//           {storePhase === "error" && error && (
//             <p className="mt-4 text-xs font-medium text-warn">{error}</p>
//           )}
//         </>
//       )}
//     </div>

//     {/* BOTTOM BUTTON CONTAINER */}
//     <div className="mt-auto pt-6">
//       <p className="mb-2 text-[11px] text-[#6e6a61]">
//         Signaling only. Files travel peer-to-peer via WebRTC.
//       </p>

//       {storeMode ? (
//         !isStoreLocked ? (
//           <button
//             type="button"
//             onClick={startStoreSend}
//             disabled={files.length === 0}
//             className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
//           >
//             <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
//               <SketchedBackground mode={files.length > 0 ? "dark" : "light"} />
//             </div>
//             <span className="relative z-10 flex items-center gap-2" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>
//               <UploadIcon color="#fff"/> Upload &amp; get link
//             </span>
//           </button>
//         ) : storePhase === "done" ? (
//           <button
//             type="button"
//             onClick={() => {
//               setStorePhase("idle");
//               setStoreResult(null);
//               setFiles([]);
//             }}
//             className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
//           >
//             <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
//               <SketchedBackground mode="outline" />
//             </div>
//             <span className="relative z-10">New store transfer</span>
//           </button>
//         ) : (
//           <button
//             type="button"
//             disabled
//             className="relative flex h-12 w-full items-center justify-center font-bold text-white cursor-not-allowed"
//           >
//             <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
//               <SketchedBackground mode="dark" />
//             </div>
//             <span className="relative z-10" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>Uploading…</span>
//           </button>
//         )
//       ) : !isLocked ? (
//         <button
//           type="button"
//           onClick={startSend}
//           disabled={files.length === 0}
//           data-tour="send-button"
//           className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
//         >
//           <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
//             <SketchedBackground mode={files.length > 0 ? "dark" : "light"} />
//           </div>
//           <span className="relative z-10 flex items-center gap-2" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>
//             <UploadIcon color="#fff"/> Send file
//           </span>
//         </button>
//       ) : (
//         <button
//           type="button"
//           onClick={cancel}
//           className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
//         >
//           <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
//             <SketchedBackground mode="outline" />
//           </div>
//           <span className="relative z-10 flex items-center gap-2">
//              Cancel send
//           </span>
//         </button>
//       )}
//     </div>

//     {/* TODO: Desktop & mobile app download links go here, right under the
//         Send button — same spot referenced in the "Desktop & mobile, on the
//         way" tutorial step (components/tutorial-modal.tsx). */}

//     {/* <div className="mt-2 w-full sm:hidden">
//       <img
//         src="/best-cat.png" // replace with your image path
//         alt=""
//         draggable={false}
//         className="w-full h-auto object-contain pointer-events-none select-none"
//       />
//     </div> */}

//   </div>
// );
// }

// // ---------------------------------------------------------------------------
// // Receive panel
// // ---------------------------------------------------------------------------

// function ReceivePanel({ turnOverride }: { turnOverride: TurnOverride | null }) {
//   const [codeInput, setCodeInput] = useState("");
//   const [phase, setPhase] = useState<ReceivePhase>("idle");
//   const [error, setError] = useState<string | null>(null);
//   const [progress, setProgress] = useState<Progress | null>(null);
//   const [receivedFile, setReceivedFile] = useState<File | null>(null);
//   const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
//     type: "unknown",
//     rttMs: null,
//   });
//   const [storePhase, setStorePhase] = useState<
//     "idle" | "loading" | "review" | "downloading" | "done" | "error"
//   >("idle");
//   const [storeManifest, setStoreManifest] = useState<StoredManifest | null>(null);
//   const [storeDownloadProgress, setStoreDownloadProgress] = useState<StoreDownloadProgress | null>(
//     null,
//   );
//   const storeKeysRef = useRef<{ id: string; keys: Awaited<ReturnType<typeof deriveKeys>> } | null>(null);

//   const signalingRef = useRef<SignalingClient | null>(null);
//   const peersRef = useRef<any[]>([]);
//   const receiverRef = useRef<FileReceiver | null>(null);
//   const statsRef = useRef<StatsMonitor | null>(null);
//   const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
//     start: 0,
//     end: 0,
//     peakBps: 0,
//   });
//   const reconnectAttemptRef = useRef(0);
//   const terminalRef = useRef(false);
//   const lastActivityRef = useRef(Date.now());
//   const phaseRef = useRef<ReceivePhase>("idle"); // mirrors `phase` for use inside stable callbacks (e.g. the signaling close handler) that shouldn't go stale

//   useEffect(() => {
//     phaseRef.current = phase;
//   }, [phase]);

//   const cleanup = useCallback(() => {
//     statsRef.current?.stop();
//     peersRef.current.forEach((p) => p.close());
//     signalingRef.current?.close();
//     statsRef.current = null;
//     peersRef.current = [];
//     signalingRef.current = null;
//   }, []);

//   useEffect(() => cleanup, [cleanup]);

//   const STALL_TIMEOUT_MS = 45_000;
//   useEffect(() => {
//     if (phase !== "connecting" && phase !== "receiving" && phase !== "verifying" && phase !== "reconnecting") return;
//     lastActivityRef.current = Date.now();
//     const interval = setInterval(() => {
//       if (terminalRef.current) return;
//       if (Date.now() - lastActivityRef.current > STALL_TIMEOUT_MS) {
//         terminalRef.current = true;
//         cleanup();
//         setError("No response from the sender for a while — the connection may have been lost.");
//         setPhase("error");
//       }
//     }, 5000);
//     return () => clearInterval(interval);
//   }, [phase, cleanup]);

//   const startReceive = async () => {
//     const input = codeInput.trim();
//     if (!input) return;
//     const parsed = parseShareLink(input);
//     if (parsed) {
//       await startStoreReceive(parsed.id, parsed.masterKey);
//     } else {
//       await startLiveReceive(input);
//     }
//   };

//   const startStoreReceive = async (id: string, masterKey: Uint8Array) => {
//     setError(null);
//     setStorePhase("loading");
//     try {
//       const status = await fetchStoredStatus(id);
//       if (status.status !== "available") {
//         setError(
//           status.status === "uploading"
//             ? "This transfer hasn't finished uploading yet."
//             : `This transfer is ${status.status}.`,
//         );
//         setStorePhase("error");
//         return;
//       }
//       const keys = await deriveKeys(masterKey);
//       const manifest = await fetchStoredManifest(id, keys);
//       setStoreManifest(manifest);
//       setStorePhase("review");
//       storeKeysRef.current = { id, keys };
//     } catch (err) {
//       setError(err instanceof Error ? err.message : "Failed to load this stored transfer.");
//       setStorePhase("error");
//     }
//   };

//   const confirmStoreDownload = async () => {
//     if (!storeManifest || !storeKeysRef.current) return;
//     setStorePhase("downloading");
//     try {
//       const files = await downloadStoredFiles(
//         storeKeysRef.current.id,
//         storeKeysRef.current.keys,
//         storeManifest,
//         (p) => setStoreDownloadProgress(p),
//       );
//       files.forEach(downloadFile);
//       setStorePhase("done");
//     } catch (err) {
//       setError(err instanceof Error ? err.message : "Download failed.");
//       setStorePhase("error");
//     }
//   };

//   const startLiveReceive = async (code: string) => {
//     setError(null);
//     setPhase("connecting");
//     reconnectAttemptRef.current = 0;
//     terminalRef.current = false;

//     try {
//       const status = await checkRoom(code);
//       if (!status.exists) {
//         setError(status.expired ? "This code has expired." : "That code doesn't exist.");
//         setPhase("error");
//         return;
//       }

//       let signaling = new SignalingClient(code, "receiver");
//       signalingRef.current = signaling;
//       await signaling.connect();

//       // Same rationale as the sender side: an idle signaling socket can die
//       // silently mid-handshake (waiting on CONFIG / the offer) without ever
//       // firing a close event. Only step in here, before a peer connection
//       // exists — once WebRTC is up, onConnectionStateChange below owns
//       // recovery.
//       signaling.onClose(() => {
//         if (terminalRef.current) return;
//         if (phaseRef.current !== "connecting") return;
//         void attemptReconnect();
//       });

//       receiverRef.current = new FileReceiver({
//         onProgress: (p) => {
//           if (terminalRef.current) return;
//           lastActivityRef.current = Date.now();
//           setPhase((prev) => (prev === "done" ? prev : "receiving"));
//           setProgress(p);
//           timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
//         },
//         onVerifying: () => {
//           if (terminalRef.current) return;
//           // All bytes are in — reassembling + hashing a large file takes
//           // real, visible time. Without this the UI just sat at 100% with
//           // nothing changing, which looked exactly like a frozen/failed
//           // download even though it was working.
//           lastActivityRef.current = Date.now();
//           setPhase("verifying");
//         },
//         onFileComplete: (file) => {
//           setReceivedFile(file);
//           downloadFile(file);
//         },
//         onAllComplete: () => {
//           if (terminalRef.current) return;
//           terminalRef.current = true;
//           timingRef.current.end = performance.now();
//           setPhase("done");
//         },
//         onError: (msg) => {
//           // See the matching comment in SendPanel's cancel(): terminalRef
//           // is set synchronously by cancel() before anything async unwinds,
//           // so a cancellation-triggered error arriving here is expected and
//           // must not overwrite the "idle" state the user already sees.
//           if (terminalRef.current) return;
//           terminalRef.current = true;
//           setError(msg);
//           setPhase("error");
//         },
//       });

//       const establishAndListen = async () => {
//         const connectionCount = await waitForConfig(signaling, MAX_PARALLEL_CONNECTIONS, 3000);

//         const onConnectionStateChange = (state: RTCPeerConnectionState) => {
//           if (state !== "failed" && state !== "disconnected") return;
//           if (terminalRef.current) return;
//           void attemptReconnect();
//         };

//         let statsStarted = false;
//         const { peers, channels } = await establishParallelReceiverConnections(
//           signaling,
//           connectionCount,
//           {
//             onConnectionStateChange,
//             onDataChannelOpen: (channel, peer) => {
//               if (peer.getConnectionIndex() === 0) {
//                 receiverRef.current?.setControlChannel(channel);
//               }
//               if (!statsStarted) {
//                 statsStarted = true;
//                 statsRef.current?.stop();
//                 if (timingRef.current.start === 0) {
//                   timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
//                 }
//                 const stats = new StatsMonitor(
//                   () => peer.getStats(),
//                   (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
//                 );
//                 stats.start();
//                 statsRef.current = stats;
//               }
//               channel.addEventListener("message", (event) => {
//                 receiverRef.current?.handleMessage(event.data);
//               });
//             },
//           },
//           undefined,
//           getIceServers(turnOverride),
//         );
//         peersRef.current = peers;

//         if (channels.length === 0 && !terminalRef.current) {
//           setError("No connection from the sender arrived. Check the code and try again.");
//           setPhase("error");
//         }
//       };

//       const attemptReconnect = async () => {
//         if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
//           terminalRef.current = true;
//           setError("Connection lost and could not be re-established.");
//           setPhase("error");
//           return;
//         }
//         const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
//         reconnectAttemptRef.current++;
//         setPhase("reconnecting");
//         statsRef.current?.stop();
//         peersRef.current.forEach((p) => p.close());
//         peersRef.current = [];
//         await new Promise((r) => setTimeout(r, delay));

//         if (!signaling.isConnected()) {
//           signaling.close();
//           signaling = new SignalingClient(code, "receiver");
//           signalingRef.current = signaling;
//           try {
//             await signaling.connect();
//           } catch {
//             terminalRef.current = true;
//             setError("Lost connection to the pairing server and could not reconnect.");
//             setPhase("error");
//             return;
//           }
//           signaling.onClose(() => {
//             if (terminalRef.current) return;
//             if (phaseRef.current !== "connecting") return;
//             void attemptReconnect();
//           });
//         }
//         void establishAndListen();
//       };

//       await establishAndListen();
//     } catch (err) {
//       setError(err instanceof Error ? err.message : "Failed to join transfer");
//       setPhase("error");
//     }
//   };

//   const cancel = () => {
//     // Same ordering fix as SendPanel: flip terminalRef before tearing
//     // anything down so a callback still unwinding from an in-flight
//     // handleMessage/finishCurrentFile call sees it and no-ops.
//     terminalRef.current = true;
//     receiverRef.current?.notifyCancel("The receiver cancelled the transfer.");
//     cleanup();
//     setPhase("idle");
//     setProgress(null);
//     setCodeInput("");
//   };

//   const isLocked = phase !== "idle";
//   const isStoreLocked = storePhase !== "idle";
//   const anyLocked = isLocked || isStoreLocked;

// return (
//   <div className="flex h-full flex-col justify-between" data-tour="receive-panel">
//     {/* TOP CONTENT WRAPPER */}
//     <div className="flex-1">
//       {/* Header — Matched to SendPanel */}
//       <div className="mb-4 flex items-center gap-3">
//         <IconBox>
//           <DownloadIcon />
//         </IconBox>
//         <div className="mt-2 flex flex-col justify-center leading-snug">
//           <h2 className="mb-2 ml-2 text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem]">
//             Receive
//           </h2>
//           <p className="ml-2 text-xs font-medium text-[#555555] leading-snug">
//             Enter a code. Review before saving.
//           </p>
//         </div>
//       </div>

//       {/* Code Input Field */}
//       <div className="mb-2">
//   <label className="mb-2 mt-3 block text-[12px] font-thin uppercase tracking-wider text-[#6e6a61]">
//     Code
//   </label>
  
//   {/* Relative wrapper with explicit overflow-visible */}
//   <div className="relative z-0 overflow-visible rounded-[6px] bg-[#f4f2eb]/70 p-1" data-tour="receive-input">
    
//     {/* Sleeping Cat Image - Higher Z-Index & Clean Positioning */}
//     <img
//       src="/sleeping-cat.png"
//       alt=""
//       draggable={false}
//       className="pointer-events-none absolute -top-[36px] right-3 z-30 h-12 w-auto select-none sm:hidden"
//     />

//     <div className="relative">
//       <div className="pointer-events-none absolute inset-0 rounded-md border border-[#2b2b2b]/30" />

//       <input
//         className="relative z-10 h-8 w-full rounded-md bg-transparent px-2 text-[12px] font-normal text-[#101010] outline-none placeholder:font-normal placeholder:text-[#9c9b98] disabled:opacity-50"
//         placeholder="word-word-word or a stored link"
//         value={codeInput}
//         disabled={anyLocked}
//         onChange={(e) => setCodeInput(e.target.value)}
//         onKeyDown={(e) => e.key === "Enter" && startReceive()}
//       />
//     </div>
//   </div>
// </div>
//       <p className="m-1 text-[12px] font-medium leading-5 text-[#494946]">
//         Paste a live code (word-word-word) or a stored transfer link, then press Enter or select Receive.
//       </p>

//       {/* Progress / Status States */}
//       {phase === "connecting" && (
//         <div className="mt-4 space-y-2">
//           <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
//           <IndeterminateBar />
//         </div>
//       )}

//       {phase === "receiving" && progress && (
//         <div className="mt-4 space-y-3">
//           <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
//           <TransferProgress
//             label="Receiving"
//             fileName={progress.fileName}
//             bytesTransferred={progress.bytesTransferred}
//             totalBytes={progress.totalBytes}
//             percent={(progress.bytesTransferred / progress.totalBytes) * 100}
//             ratePerSec={progress.ratePerSec}
//             etaSeconds={progress.etaSeconds}
//             fileIndex={progress.fileIndex}
//             totalFiles={progress.totalFiles}
//           />
//         </div>
//       )}

//       {phase === "verifying" && (
//         <div className="mt-4 space-y-2">
//           <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
//           <p className="text-xs font-medium text-[#625e55]">
//             All bytes received — verifying file integrity…
//           </p>
//           <IndeterminateBar />
//           {progress && (
//             <p className="text-[11px] font-medium text-[#625e55]">
//               {formatBytes(progress.totalBytes)} received. This can take a moment on large files —
//               it isn't stuck.
//             </p>
//           )}
//         </div>
//       )}

//       {phase === "reconnecting" && (
//         <div className="mt-4 space-y-2">
//           <p className="text-xs font-bold text-[#a84232]">
//             Connection dropped — attempting to reconnect and resume…
//           </p>
//           <IndeterminateBar />
//           {progress && (
//             <p className="text-[11px] font-medium text-[#625e55]">
//               {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already
//               received — resuming from there, not from zero.
//             </p>
//           )}
//         </div>
//       )}

//       {phase === "done" && receivedFile && (
//         <div className="mt-4 space-y-3">
//           <p className="text-xs font-bold text-[#1b5e20]">
//             ✓ All files received and verified — {receivedFile.name}
//           </p>
//           <BenchmarkSummary
//             totalBytes={receivedFile.size}
//             durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
//             avgBytesPerSec={
//               receivedFile.size / ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
//             }
//             peakBytesPerSec={timingRef.current.peakBps}
//             connectionType={connStats.type}
//             rttMs={connStats.rttMs}
//           />
//         </div>
//       )}

//       {phase === "error" && error && !isStoreLocked && (
//         <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
//       )}

//       {/* --- Stored (async) transfer flow --- */}

//       {storePhase === "loading" && (
//         <div className="mt-4 space-y-2">
//           <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
//           <IndeterminateBar />
//         </div>
//       )}

//       {storePhase === "review" && storeManifest && (
//         <div className="relative mt-4 rounded-[6px] bg-[#f4f2eb]/70 p-3 text-[#181818]">
//           <div
//             className="pointer-events-none absolute inset-0 rounded-[6px] border border-[#a09c93]"
//             style={{ filter: "url(#pencil-rough)" }}
//           />
//           <div className="relative z-10 mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6e6a61]">
//             <span>Incoming transfer</span>
//             <span>{formatBytes(storeManifest.totalSize)}</span>
//           </div>
//           <ul className="relative z-10 mb-3 divide-y divide-[#d4d0c5] border-y border-[#d4d0c5]">
//             {storeManifest.files.map((f) => (
//               <li key={f.name} className="flex items-center justify-between py-1.5 text-xs font-medium">
//                 <span className="truncate text-[#101010]">{f.name}</span>
//                 <span className="shrink-0 text-[#625e55]">{formatBytes(f.size)}</span>
//               </li>
//             ))}
//           </ul>
//           <div className="relative z-10 flex gap-2">
//             <button
//               type="button"
//               onClick={() => {
//                 setStorePhase("idle");
//                 setStoreManifest(null);
//                 setCodeInput("");
//               }}
//               className="relative flex h-10 flex-1 items-center justify-center font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
//             >
//               <div
//                 className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//                 style={{ filter: "url(#pencil-rough)" }}
//               >
//                 <SketchedBackground mode="outline" />
//               </div>
//               <span className="relative z-10 text-xs">Refuse</span>
//             </button>
//             <button
//               type="button"
//               onClick={confirmStoreDownload}
//               className="relative flex h-10 flex-1 items-center justify-center gap-1.5 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer"
//             >
//               <div
//                 className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//                 style={{ filter: "url(#pencil-rough)" }}
//               >
//                 <SketchedBackground mode="dark" />
//               </div>
//               <span
//                 className="relative z-10 flex items-center gap-1.5 text-xs"
//                 style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
//               >
//                 <DownloadIcon color="#fff" /> Download
//               </span>
//             </button>
//           </div>
//         </div>
//       )}

//       {storePhase === "downloading" && storeDownloadProgress && (
//         <div className="mt-4 space-y-2">
//           <p className="text-xs font-medium text-[#625e55]">Downloading and decrypting…</p>
//           <div
//             className="relative h-2.5 w-full overflow-hidden rounded-[4px] border border-[#7a766c] bg-[#eae7df]"
//             style={{ filter: "url(#pencil-rough)" }}
//           >
//             <div
//               className="h-full bg-[#181818] transition-all duration-200 ease-out"
//               style={{
//                 width: `${Math.min(
//                   100,
//                   (storeDownloadProgress.bytesDownloaded / storeDownloadProgress.totalBytes) * 100,
//                 )}%`,
//               }}
//             />
//           </div>
//           <p className="text-[11px] font-medium text-[#625e55]">
//             {formatBytes(storeDownloadProgress.bytesDownloaded)} / {formatBytes(storeDownloadProgress.totalBytes)}
//           </p>
//         </div>
//       )}

//       {storePhase === "done" && storeManifest && (
//         <p className="mt-4 text-xs font-bold text-[#1b5e20]">
//           ✓ All files verified and downloaded — {storeManifest.files.length} file
//           {storeManifest.files.length === 1 ? "" : "s"}.
//         </p>
//       )}

//       {storePhase === "error" && error && (
//         <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
//       )}
//     </div>

//     {/* BOTTOM BUTTON CONTAINER */}
//     <div className="mt-auto pt-6">
//       <p className="mb-2 text-right text-[11px] text-[#6e6a61]">
//         STUN only — no relay fallback by default.
//       </p>

//       {!anyLocked ? (
//         <button
//           type="button"
//           onClick={startReceive}
//           disabled={!codeInput.trim()}
//           data-tour="receive-button"
//           className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
//         >
//           <div
//             className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//             style={{ filter: "url(#pencil-rough)" }}
//           >
//             <SketchedBackground mode={codeInput.trim() ? "dark" : "light"} />
//           </div>
//           <span
//             className="relative z-10 flex items-center gap-2"
//             style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
//           >
//             <DownloadIcon color="#fff" /> Receive
//           </span>
//         </button>
//       ) : isStoreLocked && storePhase !== "review" ? (
//         <button
//           type="button"
//           onClick={() => {
//             setStorePhase("idle");
//             setStoreManifest(null);
//             setCodeInput("");
//           }}
//           className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
//         >
//           <div
//             className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//             style={{ filter: "url(#pencil-rough)" }}
//           >
//             <SketchedBackground mode="outline" />
//           </div>
//           <span className="relative z-10 flex items-center gap-2">
//             <CloseIcon /> {storePhase === "done" ? "Done" : "Cancel"}
//           </span>
//         </button>
//       ) : isLocked ? (
//         <button
//           type="button"
//           onClick={cancel}
//           className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
//         >
//           <div
//             className="absolute inset-0 z-0 h-full w-full overflow-hidden"
//             style={{ filter: "url(#pencil-rough)" }}
//           >
//             <SketchedBackground mode="outline" />
//           </div>
//           <span className="relative z-10 flex items-center gap-2">
//             <CloseIcon /> Cancel receive
//           </span>
//         </button>
//       ) : null}
//     </div>

//     {/* TODO: Desktop & mobile app download links go here, right under the
//         Receive button — same spot referenced in the "Desktop & mobile, on
//         the way" tutorial step (components/tutorial-modal.tsx). */}
//   </div>
// );
// }

// // ---------------------------------------------------------------------------
// // Small shared bits
// // ---------------------------------------------------------------------------

// function IndeterminateBar() {
//   return (
//     <div className="relative h-1 w-full overflow-hidden rounded-[3px] bg-[#eae7df]">
//       {/* Smooth border */}
//       <div className="pointer-events-none absolute inset-0 z-10 rounded-[3px] border border-[#7a766c]" />

//       {/* Animated charcoal bar */}
//       <div
//         className="h-full w-1/3 animate-[sketch-slide_1.5s_ease-in-out_infinite] rounded-[2px] bg-[#181818]"
//       />

//       <style jsx>{`
//         @keyframes sketch-slide {
//           0% {
//             transform: translateX(-100%);
//           }

//           100% {
//             transform: translateX(300%);
//           }
//         }
//       `}</style>
//     </div>
//   );
// }

// function IconBox({ children }: { children: React.ReactNode }) {
//   return (
//     <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#050505]/70 bg-transparent">
//       {children}
//     </div>
//   );
// }

// function UploadIcon({ color = "#3B3B3C" }: { color?: string }) {
//   return (
//     <svg
//       width="20"
//       height="20"
//       viewBox="0 0 24 24"
//       fill="none"
//       stroke={color}
//       strokeWidth="1.8"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//     >
//       <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
//       <polyline points="17 8 12 3 7 8" />
//       <line x1="12" y1="3" x2="12" y2="15" />
//     </svg>
//   );
// }

// function DownloadIcon({ color = "#3B3B3C" }: { color?: string }) {
//   return (
//     <svg
//       width="20"
//       height="20"
//       viewBox="0 0 24 24"
//       fill="none"
//       stroke={color}
//       strokeWidth="1.8"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//     >
//       <path d="M12 4v12M6 10l6 6 6-6" />
//       <path d="M4 20h16" />
//       <line x1="12" y1="3" x2="12" y2="15" />
//     </svg>
//   );
// }

// function CloseIcon() {
//   return (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
//       <path d="M18 6 6 18M6 6l12 12" />
//     </svg>
//   );
// }

// apps/web/app/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { CodeDisplay } from "@/components/code-display";
import { TransferProgress } from "@/components/transfer-progress";
import { createRoom, checkRoom, SignalingClient, waitForMessage } from "@/lib/signaling/client";
import { PeerConnection } from "@/lib/webrtc/peer";
import { sendFiles, FileReceiver, downloadFile, type TransferProgress as Progress } from "@/lib/webrtc/transfer";
import { StatsMonitor, type ConnectionType } from "@/lib/webrtc/stats";
import {
  establishParallelSenderConnections,
  establishParallelReceiverConnections,
  MAX_PARALLEL_CONNECTIONS,
} from "@/lib/webrtc/multi-peer";
import { ConnectionStatus } from "@/components/connection-status";
import { BenchmarkSummary } from "@/components/benchmark-summary";
import { RelaySettings } from "@/components/relay-settings";
import { getIceServers, type TurnOverride } from "@/lib/webrtc/ice-config";
import { uploadStored, fetchStoredStatus, fetchStoredManifest, downloadStoredFiles, revokeStored, type StoreUploadProgress, type StoreDownloadProgress } from "@/lib/store/storeclient";
import { deriveKeys, parseShareLink } from "@/lib/store/storecrypto";
import { STORED_TRANSFER_DEFAULT_TTL_MS } from "@fast-transfer/protocol";
import type { StoredManifest } from "@fast-transfer/protocol";
import { formatBytes } from "@/lib/format";
import { TutorialModal, useTutorialAutoOpen } from "@/components/tutorial-modal";

type SendPhase = "idle" | "waiting" | "connecting" | "sending" | "reconnecting" | "done" | "error";
type ReceivePhase = "idle" | "connecting" | "receiving" | "verifying" | "reconnecting" | "done" | "error";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://getfasttransfer.app";
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];

function waitForConfig(signaling: SignalingClient, fallback: number, timeoutMs: number): Promise<number> {
  return waitForMessage(
    signaling,
    "CONFIG",
    (msg) => (msg.payload as { connectionCount: number })?.connectionCount ?? fallback,
    fallback,
    timeoutMs,
  );
}

// export default function HomePage() {
//   const [turnOverride, setTurnOverride] = useState<TurnOverride | null>(null);

//   return (
//   <main className="relative min-h-screen w-full overflow-hidden  text-[#1a1a1a]">
//       <div className="fixed inset-0 -z-10 pointer-events-none">
//         <img
//           src="/handdrawn-bg.png"
//           alt=""
//           draggable={false}
//           className="h-full w-full object-cover"
//         />
//       </div>
//       <div className="mx-auto max-w-5xl z-10">
//         <header className="mb-8">
//           <h1 className="text-3xl font-bold tracking-tight">
//             fast-transfer<span className="text-muted">.</span>
//           </h1>
//           <p className="mt-1 text-sm text-muted">
//             Direct browser-to-browser file transfer. Encrypted end-to-end. Nothing touches our servers.
//           </p>
//         </header>

//         <div className="grid gap-6 border-none bg-transparent p-0 sm:grid-cols-2">
//           <div className=" border-none sm:border-b-0 sm:border-r">
//             <SendPanel turnOverride={turnOverride} />
//           </div>
//           <div className=" border-0">
//             <ReceivePanel turnOverride={turnOverride} />
//           </div>
//         </div>

//         {/* <div className="mt-4">
//           <RelaySettings value={turnOverride} onChange={setTurnOverride} />
//         </div> */}

//         <footer className="mt-4 flex items-center justify-between text-[11px] text-muted">
//           <span>Signaling only. Files travel peer-to-peer via WebRTC.</span>
//           <span>
//             {turnOverride ? "Custom TURN configured for this session." : "STUN only — no relay fallback by default."}
//           </span>
//         </footer>
//       </div>
//     </main> 
//   );
// }


// Flying Butterfly Component
function FlyingButterfly() {
  const [key, setKey] = useState(0);
  const [lastExitPoint, setLastExitPoint] = useState<{ x: number; y: number } | null>(null);
  const [flightConfig, setFlightConfig] = useState<any>(null);

  useEffect(() => {
    // Helper to generate a random edge coordinate
    const getRandomEdgeCoords = () => {
      const edge = Math.floor(Math.random() * 4);
      switch (edge) {
        case 0: return { x: Math.random() * 80 + 10, y: -10 }; // Top
        case 1: return { x: 110, y: Math.random() * 80 + 10 };  // Right
        case 2: return { x: Math.random() * 80 + 10, y: 110 }; // Bottom
        case 3: return { x: -10, y: Math.random() * 80 + 10 };  // Left
        default: return { x: -10, y: -10 };
      }
    };

    // 1. Entry point: Uses the last exit point if available; otherwise picks a random edge
    const start = lastExitPoint || getRandomEdgeCoords();

    // 2. Pick a new random exit edge (ensuring it's not starting and ending at the exact same spot)
    let end = getRandomEdgeCoords();

    // 3. Generate completely random wandering waypoints across the screen (not restricted to flowers)
    const wanderSpot1 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };
    const wanderSpot2 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };
    const wanderSpot3 = { x: Math.random() * 70 + 15, y: Math.random() * 60 + 20 };

    // Save current exit point for the NEXT flight cycle
    setLastExitPoint(end);

    // Compute rotation angles towards each random point
    const calcAngle = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
      const radians = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      return Math.round((radians * 180) / Math.PI) + 90;
    };

    const angle1 = calcAngle(start, wanderSpot1);
    const angle2 = calcAngle(wanderSpot1, wanderSpot2);
    const angle3 = calcAngle(wanderSpot2, wanderSpot3);
    const angle4 = calcAngle(wanderSpot3, end);

    const duration = Math.floor(Math.random() * 6) + 18; // Smooth 18s - 24s flight path

    setFlightConfig({
      start,
      end,
      wanderSpot1,
      wanderSpot2,
      wanderSpot3,
      angle1,
      angle2,
      angle3,
      angle4,
      duration,
    });
  }, [key]);

  // Rest pause between flight cycles
  const handleAnimationEnd = () => {
    const pauseDelay = Math.floor(Math.random() * 6000) + 4000; // 4 to 10 seconds break
    setTimeout(() => {
      setKey((prev) => prev + 1);
    }, pauseDelay);
  };

  if (!flightConfig) return null;

  return (
    <>
      <style>{`
        /* Dynamic wing flapping speed: Fast during flight, slow during resting pause */
        @keyframes flapLeft {
          0%, 100% { transform: scaleX(1); }
          50% { transform: scaleX(0.15); }
        }

        @keyframes flapRight {
          0%, 100% { transform: scaleX(1); }
          50% { transform: scaleX(0.15); }
        }

        .butterfly-left-wing {
          transform-origin: 20px 18px;
          animation: flapLeft 0.18s ease-in-out infinite;
        }

        .butterfly-right-wing {
          transform-origin: 20px 18px;
          animation: flapRight 0.18s ease-in-out infinite;
        }

        /* Smooth wandering flight path with resting pauses */
        @keyframes dynamicFlightPath_${key} {
          0% {
            top: ${flightConfig.start.y}%;
            left: ${flightConfig.start.x}%;
            transform: rotate(${flightConfig.angle1}deg) scale(0.85);
          }
          20% {
            top: ${flightConfig.wanderSpot1.y}%;
            left: ${flightConfig.wanderSpot1.x}%;
            transform: rotate(${flightConfig.angle1}deg) scale(1);
          }
          /* Hover & pause at point 1 */
          28% {
            top: ${flightConfig.wanderSpot1.y + 1}%;
            left: ${flightConfig.wanderSpot1.x - 1}%;
            transform: rotate(${flightConfig.angle2 - 10}deg) scale(0.95);
          }
          48% {
            top: ${flightConfig.wanderSpot2.y}%;
            left: ${flightConfig.wanderSpot2.x}%;
            transform: rotate(${flightConfig.angle2}deg) scale(0.9);
          }
          /* Gentle flutter pause at point 2 */
          54% {
            top: ${flightConfig.wanderSpot2.y - 2}%;
            left: ${flightConfig.wanderSpot2.x + 1}%;
            transform: rotate(${flightConfig.angle3 + 10}deg) scale(1);
          }
          75% {
            top: ${flightConfig.wanderSpot3.y}%;
            left: ${flightConfig.wanderSpot3.x}%;
            transform: rotate(${flightConfig.angle3}deg) scale(0.95);
          }
          82% {
            top: ${flightConfig.wanderSpot3.y + 1}%;
            left: ${flightConfig.wanderSpot3.x + 2}%;
            transform: rotate(${flightConfig.angle4}deg) scale(0.9);
          }
          100% {
            top: ${flightConfig.end.y}%;
            left: ${flightConfig.end.x}%;
            transform: rotate(${flightConfig.angle4}deg) scale(0.8);
          }
        }

        .dynamic-butterfly {
          position: absolute;
          z-index: 20;
          pointer-events: none;
          width: 36px;
          height: 36px;
          animation: dynamicFlightPath_${key} ${flightConfig.duration}s ease-in-out forwards;
        }
      `}</style>

      {/* Rendered Butterfly */}
      <div
        key={key}
        className="dynamic-butterfly"
        onAnimationEnd={handleAnimationEnd}
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="butterflyFilter" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="1" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <pattern id="wingPattern" width="3" height="3" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="3" stroke="#1c1c1e" strokeWidth="0.7" opacity="0.25" />
            </pattern>
          </defs>

          <g filter="url(#butterflyFilter)">
            {/* Left Wing */}
            <g className="butterfly-left-wing">
              <path d="M 20 18 C 10 3, 1 7, 3 16 C 5 22, 15 20, 20 18 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.6" />
              <path d="M 18 17 C 11 7, 4 10, 6 16 C 8 19, 15 18, 18 17 Z" fill="url(#wingPattern)" stroke="#1c1c1e" strokeWidth="0.7" />
              <path d="M 19 19 C 10 21, 5 27, 9 31 C 13 33, 18 25, 19 19 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.4" />
            </g>

            {/* Right Wing */}
            <g className="butterfly-right-wing">
              <path d="M 20 18 C 30 3, 39 7, 37 16 C 35 22, 25 20, 20 18 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.6" />
              <path d="M 22 17 C 29 7, 36 10, 34 16 C 32 19, 25 18, 22 17 Z" fill="url(#wingPattern)" stroke="#1c1c1e" strokeWidth="0.7" />
              <path d="M 21 19 C 30 21, 35 27, 31 31 C 27 33, 22 25, 21 19 Z" fill="#FAFAFA" stroke="#1c1c1e" strokeWidth="1.4" />
            </g>

            {/* Body */}
            <ellipse cx="20" cy="19" rx="1.2" ry="5.5" fill="#1c1c1e" />
            <circle cx="20" cy="13" r="1" fill="#1c1c1e" />
            <path d="M 20 13 C 18 9, 15 8, 13 9" stroke="#1c1c1e" strokeWidth="0.8" fill="none" />
            <path d="M 20 13 C 22 9, 25 8, 27 9" stroke="#1c1c1e" strokeWidth="0.8" fill="none" />
          </g>
        </svg>
      </div>
    </>
  );
}
const PaperAirplaneIcon = ({ size = 32 }: { size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: "visible" }}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <filter
          id="kimo-pencil-sketch"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.04"
            numOctaves="3"
            result="noise"
          />

          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />

          <feMorphology
            operator="dilate"
            radius="0.3"
            in="SourceGraphic"
          />
        </filter>
      </defs>

      <g filter="url(#kimo-pencil-sketch)">
        <g
          stroke="#575656"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Top wing */}
          <path
            d="M30 46 L85 32"
            strokeWidth="3"
          />

          {/* Main right wing */}
          <path
            d="M85 32 L60 72"
            strokeWidth="3"
          />

          {/* Bottom wing fold */}
          <path
            d="M60 72 L42 54"
            strokeWidth="2.5"
          />

          {/* Back edge */}
          <path
            d="M30 46 L42 54"
            strokeWidth="3"
          />

          {/* Center spine */}
          <path
            d="M85 32 L42 54"
            strokeWidth="2.5"
          />

          {/* Curved back flap */}
          <path
            d="M42 54 C40 64 46 68 50 63"
            strokeWidth="2.5"
          />

          {/* Flight trail */}
          <path
            d="M26 74 L36 67"
            strokeWidth="2.5"
            strokeDasharray="4 4"
          />
        </g>
      </g>
    </svg>
  );
};

export default function HomePage() {
  const [turnOverride, setTurnOverride] = useState<TurnOverride | null>(null);
  // Mobile only: which panel (Send/Receive) is currently shown. On sm+ screens
  // both panels are shown side-by-side as before, this only matters below sm.
  const [mobileView, setMobileView] = useState<"send" | "receive">("send");

  // Hand-drawn "how this works" walkthrough. Opens from the header's help
  // icon, and — optionally — once automatically for first-time visitors.
  // Remove the useTutorialAutoOpen(...) line below if you only want the
  // manual icon trigger.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  useTutorialAutoOpen(setTutorialOpen);

  // If the page was opened via a shared receive link
  // (`${APP_URL}/?code=word-word-word`), pick the code up from the URL and
  // drop it straight into the Receive panel's input instead of making the
  // visitor copy-paste it. Read via window.location (not useSearchParams)
  // so this keeps working in the static export the desktop app ships, with
  // no Suspense boundary needed.
  const [initialCode, setInitialCode] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      setInitialCode(code);
      // On mobile the two panels are tabbed — jump to Receive so the
      // prefilled code is actually visible instead of hidden behind Send.
      setMobileView("receive");
    }
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-hidden text-[#1a1a1a]">
      {/* Background Image */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <img
          src="/handdrawn-bg.png"
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </div>

      {/* Dynamic Flying Butterfly Effect */}
      <FlyingButterfly />

      {/* Hand-drawn "how this works" walkthrough, opened from the help
          icon in the header (see nav below). */}
      <TutorialModal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        mobileView={mobileView}
        setMobileView={setMobileView}
      />

      <div className="mx-auto max-w-5xl z-10 relative pt-4 px-4 sm:px-6 lg:px-8">
        <header className="mb-2 flex items-center justify-between gap-2">
  {/* Left side: Logo + Text + Sparkle */}
  <div className="flex items-center gap-1">
    <span className="sm:hidden">
      <PaperAirplaneIcon size={36} />
    </span>
    <span className="hidden sm:inline-flex">
      <PaperAirplaneIcon size={52} />
    </span>

    <div className="flex items-center">
      <span className="text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-[#595858]">
        kimo
      </span>

      {/* Sparkle burst */}
      <svg
        width="22"
        height="26"
        viewBox="0 0 28 32"
        fill="none"
        className="ml-0.5 mt-1 shrink-0 sm:h-8 sm:w-7"
        aria-hidden="true"
      >
        <path d="M 6 7 L 12 3" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 11 12 L 18 9" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 12 17 L 20 17" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 11 22 L 18 25" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 6 26 L 11 30" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="23" cy="12" r="1" fill="#575656" />
        <circle cx="22" cy="22" r="1" fill="#575656" />
      </svg>
    </div>
  </div>

  {/* Right side: Hand-drawn style navigation with dividers */}
  <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3 text-[#575656]">
    {/* Hand-Drawn Help (Tutorial trigger) Icon — opens the walkthrough modal */}
    <button
      type="button"
      onClick={() => setTutorialOpen(true)}
      className="transition-opacity hover:opacity-70"
      aria-label="How kimo works"
    >
      <svg
        className="h-4 w-4 sm:h-5 sm:w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Hand-drawn wobbly circle */}
        <path d="M12 3.3c4.9-.2 8.7 3.5 8.7 8.2s-3.9 8.6-8.8 8.5C7.2 20 3.4 16.4 3.4 11.7S7.1 3.5 12 3.3Z" />
        {/* Hand-drawn question mark */}
        <path d="M9.6 9.3c.3-1.6 1.7-2.6 3.3-2.4 1.5.2 2.6 1.4 2.5 2.8-.1 1.6-1.5 2.1-2.4 2.9-.6.6-.8 1.1-.8 1.9" />
        <circle cx="12.1" cy="16.7" r="1" fill="currentColor" stroke="none" />
      </svg>
    </button>

    {/* Hand-Drawn Bar Divider */}
    <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
      <path d="M 3 1.5 C 2.8 6, 3.2 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
    </svg>

    {/* Open Book (Tutorials) Icon */}
    <a
      href="/blog"
      className="transition-opacity hover:opacity-70"
      aria-label="Blog / Info"
    >
      <svg
        className="h-4 w-4 sm:h-5 sm:w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Left page outline */}
        <path d="M12 6.5C10 4.8 6.5 4.5 3 6v12.5c3.5-1.2 7-.9 9 .8" />
        {/* Right page outline */}
        <path d="M12 6.5C14 4.8 17.5 4.5 21 6v12.5c-3.5-1.2-7-.9-9 .8" />
        {/* Book spine line */}
        <path d="M12 6.5v12.8" />
        {/* Text lines on left page */}
        <path d="M5.5 9h4M5.5 12h4M5.5 15h3" strokeWidth="1.5" />
        {/* Text lines on right page */}
        <path d="M14.5 9h4M14.5 12h4M14.5 15h3" strokeWidth="1.5" />
      </svg>
    </a>

    {/* Hand-Drawn Bar Divider */}
    <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
      <path d="M 3 1.5 C 2.8 6, 3.2 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
    </svg>

    

    {/* Hand-Drawn Double-Line X (Twitter) Icon */}
    <a
      href="https://x.com/shivamdotdev"
      target="_blank"
      rel="noreferrer"
      className="transition-opacity hover:opacity-70"
      aria-label="X (Twitter)"
    >
      <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M 18.2 3 L 21.5 3 L 14.3 11.2 L 22.8 21 L 16.2 21 L 11 14.2 L 5 21 L 1.7 21 L 9.4 12.2 L 1.2 3 L 8 3 L 12.7 9.2 L 18.2 3 Z M 17.1 19.5 L 18.9 19.5 L 7.1 4.4 L 5.1 4.4 L 17.1 19.5 Z" />
      </svg>
    </a>

    {/* Hand-Drawn Bar Divider */}
    <svg width="6" height="18" viewBox="0 0 6 18" fill="none" className="shrink-0">
      <path d="M 3 1.5 C 2.9 6, 3.1 12, 3 16.5" stroke="#575656" strokeWidth="1.8" strokeLinecap="round" />
    </svg>

    {/* Hand-Drawn Rounded Box "in" (LinkedIn) Icon */}
    <a
      href="https://www.linkedin.com/in/shivamdotdev"
      target="_blank"
      rel="noreferrer"
      className="transition-opacity hover:opacity-70"
      aria-label="LinkedIn"
    >
      <svg
        className="h-5 w-5 sm:h-6 sm:w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Hand-drawn rounded square frame */}
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        {/* 'i' dot */}
        <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
        {/* 'i' stem */}
        <path d="M8 11v6" strokeWidth="2" />
        {/* 'n' stem and arch */}
        <path d="M12.5 11v6" strokeWidth="2" />
        <path d="M12.5 13.8c0-1.5 1-2.3 2.2-2.3s2.3.8 2.3 2.3V17" strokeWidth="2" />
      </svg>
    </a>
  </nav>
</header>

{/* Hand-Drawn Pencil Divider (Ultra-thin & light taper) */}
<div className="mb-5 w-full overflow-hidden" aria-hidden="true">
  <svg
    viewBox="0 0 1000 10"
    fill="none"
    preserveAspectRatio="none"
    className="h-2 w-full"
  >
    {/* Very light & delicate single pencil line tapered from ~0.4px ends to ~1.4px center */}
    <path
      d="M 5 5 C 250 4.2, 750 5.8, 995 5"
      fill="none"
      stroke="#575656"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.35"
    />
  </svg>
</div>


<div className="mx-auto max-w-5xl mb-3">
  {/* Mobile-only Send/Receive toggle — replaces the stacked layout below sm */}
  <MobileViewToggle view={mobileView} setView={setMobileView} />

  {/* Set a min-height or fixed height so the panel has space to push buttons down */}
  {/* grid-cols-1 (== repeat(1, minmax(0,1fr))) is required below sm: without it,
      an implicit auto-sized grid track is used, which is allowed to grow past
      the container's width to fit any long unwrapped content inside (the
      browser link, the code chip, etc.) — that's what was dragging the whole
      column, and every full-width row inside it, off the right edge of the
      screen on mobile. */}
<div className="relative grid min-h-[calc(100vh-180px)] grid-cols-1 sm:min-h-[650px] items-stretch gap-6 sm:gap-8 border-none bg-transparent p-0 sm:grid-cols-2">
  
  {/* Left Column Container (Send) */}
  <div
    className={`min-w-0 flex-1 flex-col justify-between sm:pr-6 ${
      mobileView === "send" ? "flex" : "hidden"
    } sm:flex`}
  >
    <SendPanel turnOverride={turnOverride} />
  </div>

  {/* Center Divider Line */}
  <div
    className="absolute inset-y-0 left-1/2 hidden -translate-x-1/2 sm:block"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 10 100"
      preserveAspectRatio="none"
      className="h-full w-2"
    >
      <path
        d="M 5 1 C 4.2 25, 5.8 75, 5 99"
        stroke="#575656"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  </div>

  {/* Right Column Container (Receive) */}
  <div
    className={`min-w-0 flex-1 flex-col justify-between sm:pl-6 ${
      mobileView === "receive" ? "flex" : "hidden"
    } sm:flex`}
  >
    <ReceivePanel turnOverride={turnOverride} initialCode={initialCode} />
  </div>

</div>
</div>

        {/* <footer className="mt-4 flex items-center justify-between text-[11px] text-muted">
          <span>Signaling only. Files travel peer-to-peer via WebRTC.</span>
          <span>
            {turnOverride ? "Custom TURN configured for this session." : "STUN only — no relay fallback by default."}
          </span>
        </footer> */}

        
      </div>
    </main>
  );
}

interface ModeTabsProps {
  storeMode: boolean;
  setStoreMode: (mode: boolean) => void;
  disabled?: boolean;
}

interface MobileViewToggleProps {
  view: "send" | "receive";
  setView: (view: "send" | "receive") => void;
}

// Small-screen only segmented control that swaps between the Send and
// Receive panels instead of stacking them top/bottom. Both panels stay
// mounted (just hidden via CSS) so in-progress transfers are never reset
// by switching tabs. Hidden entirely at sm+ where the two-column layout
// already shows both panels side by side.
function MobileViewToggle({ view, setView }: MobileViewToggleProps) {
  return (
    <div className="mb-4 w-full sm:hidden" data-tour="mobile-toggle">
      <div className="flex h-11 w-full overflow-hidden rounded-md border-2 border-[#dcdbdb] bg-transparent">
        <button
          type="button"
          onClick={() => setView("send")}
          className={`relative flex flex-1 items-center justify-center gap-1.5 text-sm font-bold transition-all cursor-pointer ${
            view !== "send" ? "text-[#101010] hover:bg-[#101010]/5" : "text-white"
          }`}
        >
          {view === "send" && (
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <PencilTextureCanvas />
            </div>
          )}
          <span
            className="relative z-10 flex items-center gap-1.5"
            style={
              view === "send"
                ? {
                    textShadow:
                      "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
                  }
                : undefined
            }
          >
            <UploadIcon color={view === "send" ? "#fff" : "#3B3B3C"} /> Send
          </span>
        </button>

        <button
          type="button"
          onClick={() => setView("receive")}
          className={`relative flex flex-1 items-center justify-center gap-1.5 text-sm font-bold transition-all cursor-pointer ${
            view !== "receive" ? "text-[#101010] hover:bg-[#101010]/5" : "text-white"
          }`}
        >
          {view === "receive" && (
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <PencilTextureCanvas />
            </div>
          )}
          <span
            className="relative z-10 flex items-center gap-1.5"
            style={
              view === "receive"
                ? {
                    textShadow:
                      "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
                  }
                : undefined
            }
          >
            <DownloadIcon color={view === "receive" ? "#fff" : "#3B3B3C"} /> Receive
          </span>
        </button>
      </div>
    </div>
  );
}

function PencilTextureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Light off-white base paper layer
    ctx.fillStyle = "#dedcd5";
    ctx.fillRect(0, 0, w, h);

    // 2. Heavy diagonal pencil shading pass 1 (dark gray/black)
    ctx.strokeStyle = "#1e1e1e";
    for (let x = -h; x < w + h; x += 3.5) {
      ctx.lineWidth = 1.2 + Math.random() * 1.5;
      ctx.globalAlpha = 0.6 + Math.random() * 0.35;
      ctx.beginPath();
      ctx.moveTo(x + (Math.random() * 2 - 1), 0);
      ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
      ctx.stroke();
    }

    // 3. Dense cross-hatching pass 2 (medium graphite)
    ctx.strokeStyle = "#383838";
    for (let x = -h; x < w + h; x += 4) {
      ctx.lineWidth = 1 + Math.random() * 1.2;
      ctx.globalAlpha = 0.4 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.moveTo(x + h, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // 4. Dark smudge patches along the edges
    ctx.fillStyle = "#121212";
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.15 + Math.random() * 0.25;
      const rx = Math.random() * w;
      const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
      ctx.beginPath();
      ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Hand-drawn outer border
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 6);
    ctx.stroke();

    // 6. Inner sketch outline
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 4);
    ctx.stroke();

    // 7. Corner 'X' registration marks
    const drawX = (cx: number, cy: number) => {
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.moveTo(cx + 3, cy - 3);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.stroke();
    };
    drawX(10, 10);
    drawX(w - 10, 10);
    drawX(10, h - 10);
    drawX(w - 10, h - 10);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={40}
      className="absolute inset-0 h-full w-full rounded-[6px]"
    />
  );
}

function ModeTabs({ storeMode, setStoreMode, disabled }: ModeTabsProps) {
  return (
    <div className="mb-3 w-full">
      {/* Rough edge displacement filter */}
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="pencil-rough">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.08"
              numOctaves="2"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="1.8"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Segmented Outer Shell */}
      <div className="flex h-11 w-full overflow-visible rounded-md border-2 border-[#dcdbdb] bg-transparent">
        {/* Direct Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setStoreMode(false)}
          className={`relative flex flex-1 items-center justify-center text-sm font-bold transition-all ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          } ${!storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
        >
          {!storeMode && (
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <PencilTextureCanvas />
            </div>
          )}
          <span
            className="relative z-10"
            style={
              !storeMode
                ? {
                    textShadow:
                      "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
                  }
                : undefined
            }
          >
            Direct
          </span>
        </button>

<button
  type="button"
  disabled={disabled}
  onClick={() => setStoreMode(true)}
  className={`relative flex flex-1 items-center justify-center overflow-visible text-sm font-bold transition-all ${
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
  } ${storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
>
{/* Sitting Character - Shifted Right */}
<img
  src="/sitting-character.png"
  alt=""
  draggable={false}
  className="pointer-events-none absolute -top-[72px] left-[90%] z-20 h-28 w-auto -translate-x-1/2 select-none sm:hidden"
/>

  {storeMode && (
    <div
      className="absolute inset-0 z-0 h-full w-full overflow-hidden"
      style={{ filter: "url(#pencil-rough)" }}
    >
      <PencilTextureCanvas />
    </div>
  )}

  <span
    className="relative z-10"
    style={
      storeMode
        ? {
            textShadow:
              "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
          }
        : undefined
    }
  >
    Store for 1 day
  </span>
</button>
      </div>
    </div>
  );
}

// Shown instead of the upload UI when "Store for 1 day" is selected — the
// feature isn't wired up for real users yet, so this replaces the upload
// flow with an honest (and hopefully charming) "still cooking" notice
// rather than letting people upload into something unfinished.
function StoreComingSoon() {
  return (
    <div className="mt-2 flex flex-col items-center justify-center gap-3 rounded-[6px] border-2 border-dashed border-[#dcdbdb] bg-[#f4f2eb]/50 px-4 py-10 text-center">
      <span className="text-3xl" aria-hidden="true">
        🛠️🐛
      </span>
      <p className="text-sm font-bold text-[#575656]">Store-for-1-day is still being built.</p>
      <p className="max-w-[26ch] text-xs text-[#6e6a61]">
        The developer is currently in a staring contest with a very stubborn bug over who really
        owns this feature. Hang tight — <span className="font-semibold">Direct</span> transfers
        work great in the meantime!
      </p>
    </div>
  );
}

interface SketchedBackgroundProps {
  mode?: "light" | "dark" | "outline";
  className?: string;
}

function SketchedBackground({ mode = "light", className = "" }: SketchedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Redraws the sketch texture at the canvas's *current* rendered box size.
    // Re-running this on resize (not just on mount / mode change) is what
    // keeps the border and corner registration marks pixel-accurate — if the
    // box's width changes after the initial paint (e.g. a layout reflow, an
    // orientation change, or a viewport resize) without this, the old
    // fixed-resolution texture gets stretched by the browser to fill the new
    // box size, which is what made the corner marks appear to drift outside
    // the button edge.
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = (canvas.width = rect.width || 460);
      const h = (canvas.height = rect.height || 48);

      ctx.clearRect(0, 0, w, h);

      if (mode === "dark") {
      // Dark Active State
      ctx.fillStyle = "#121212";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#000000";
      for (let x = -h; x < w + h; x += 3) {
        ctx.lineWidth = 1.2 + Math.random();
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }

      ctx.fillStyle = "#000000";
      for (let i = 0; i < 35; i++) {
        ctx.globalAlpha = 0.35;
        const rx = Math.random() * w;
        const ry = Math.random() * h;
        ctx.beginPath();
        ctx.arc(rx, ry, 3 + Math.random() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === "light") {
      // Idle State (Exact snippet provided)
      ctx.fillStyle = "#dedcd5";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#1e1e1e";
      for (let x = -h; x < w + h; x += 3.5) {
        ctx.lineWidth = 1.2 + Math.random() * 1.5;
        ctx.globalAlpha = 0.6 + Math.random() * 0.35;
        ctx.beginPath();
        ctx.moveTo(x + (Math.random() * 2 - 1), 0);
        ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
        ctx.stroke();
      }

      ctx.strokeStyle = "#383838";
      for (let x = -h; x < w + h; x += 4) {
        ctx.lineWidth = 1 + Math.random() * 1.2;
        ctx.globalAlpha = 0.4 + Math.random() * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + h, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      ctx.fillStyle = "#121212";
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.15 + Math.random() * 0.25;
        const rx = Math.random() * w;
        const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
        ctx.beginPath();
        ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Outer & Inner borders
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 6);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 4);
    ctx.stroke();

    // Registration Marks
    const drawX = (cx: number, cy: number) => {
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.moveTo(cx + 3, cy - 3);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.stroke();
    };
    drawX(10, 10);
    drawX(w - 10, 10);
    drawX(10, h - 10);
    drawX(w - 10, h - 10);
    };

    draw();

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full pointer-events-none rounded-[6px] ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Send panel
// ---------------------------------------------------------------------------

function SendPanel({ turnOverride }: { turnOverride: TurnOverride | null }) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parallelMode, setParallelMode] = useState(false);
  const [storeMode, setStoreMode] = useState(false);
  const [storePhase, setStorePhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [storeProgress, setStoreProgress] = useState<StoreUploadProgress | null>(null);
  const [storeResult, setStoreResult] = useState<{ shareUrl: string; revokeToken: string; id: string } | null>(
    null,
  );
  const [progress, setProgress] = useState<Progress | null>(null);
  const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
    type: "unknown",
    rttMs: null,
  });

  const signalingRef = useRef<SignalingClient | null>(null);
  const peersRef = useRef<PeerConnection[]>([]);
  const channelsRef = useRef<RTCDataChannel[]>([]);
  const statsRef = useRef<StatsMonitor | null>(null);
  const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
    start: 0,
    end: 0,
    peakBps: 0,
  });
  // Resume checkpoint: how far we got before a drop, so a reconnect can
  // continue with only the remaining files instead of restarting the batch
  // (PRD §21). bytesAlreadySent is an *estimate* used only for progress
  // display continuity — the chunk-level resume protocol in sendFiles is
  // what actually guarantees correctness, this just keeps the bar honest.
  const resumeRef = useRef<{
    remainingFiles: File[];
    bytesAlreadySent: number;
    totalFiles: number;
    totalBytes: number;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const terminalRef = useRef(false); // set once done/error/cancelled, so a late connection-state event or in-flight callback doesn't trigger a pointless reconnect or overwrite the UI after the user already left
  const abortControllerRef = useRef<AbortController | null>(null); // lets us stop an in-flight sendFiles() promptly on cancel instead of it hanging or resolving late
  const phaseRef = useRef<SendPhase>("idle"); // mirrors `phase` for use inside stable callbacks (e.g. the signaling close handler) that shouldn't go stale

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const cleanup = useCallback(() => {
    statsRef.current?.stop();
    peersRef.current.forEach((p) => p.close());
    signalingRef.current?.close();
    statsRef.current = null;
    peersRef.current = [];
    channelsRef.current = [];
    signalingRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startSend = async () => {
    if (files.length === 0) return;
    setError(null);
    setPhase("waiting");
    reconnectAttemptRef.current = 0;
    terminalRef.current = false;
    abortControllerRef.current = new AbortController();
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    resumeRef.current = {
      remainingFiles: files,
      bytesAlreadySent: 0,
      totalFiles: files.length,
      totalBytes,
    };
    // Parallel (4x) connections are used only when the person manually
    // ticks the "Parallel connections" checkbox before hitting Send — no
    // auto-enabling here.

    try {
      const room = await createRoom();
      setCode(room.code);

      let signaling = new SignalingClient(room.code, "sender");
      signalingRef.current = signaling;
      await signaling.connect();

      const attachTopLevelHandlers = (client: SignalingClient) => {
        client.onMessage((msg) => {
          if (msg.type === "PEER_JOINED") {
            void establishAndRun();
          }
          if (msg.type === "PEER_LEFT") {
            terminalRef.current = true;
            setError("The receiver disconnected.");
            setPhase("error");
          }
        });
        // The signaling WebSocket can die silently while we're just sitting
        // on the "waiting for recipient" screen (idle connections get
        // dropped by proxies/NATs without a close frame) — this is what
        // made "click send, wait a bit, then have the receiver enter the
        // code" fail with no explanation. Only auto-recover here while we
        // haven't paired yet; once WebRTC takes over, a dead peer
        // connection is handled by onConnectionStateChange below instead.
        client.onClose(() => {
          if (terminalRef.current) return;
          if (phaseRef.current !== "waiting") return;
          void attemptReconnect();
        });
      };

      const runTransfer = (channels: RTCDataChannel[], primaryPeer: PeerConnection) => {
        setPhase("sending");
        channelsRef.current = channels;
        if (timingRef.current.start === 0) {
          timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
        }

        statsRef.current?.stop();
        const stats = new StatsMonitor(
          () => primaryPeer.getStats(),
          (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
        );
        stats.start();
        statsRef.current = stats;

        const checkpoint = resumeRef.current!;
        // The real, per-connection negotiated SCTP limit — take the
        // minimum across every connection in use (parallel mode can have
        // more than one) so no single connection's chunk gets rejected.
        // This is the actual fix for "Trying to send message larger than
        // max-message-size" — see resolveChunkSize in transfer.ts.
        const maxMessageSize = peersRef.current.reduce<number | null>((min, p) => {
          const size = p.getMaxMessageSize();
          if (size == null) return min;
          return min == null ? size : Math.min(min, size);
        }, null);
        void sendFiles(
          channels,
          checkpoint.remainingFiles,
          {
            onProgress: (p) => {
              if (terminalRef.current) return; // cancelled/finished already — don't resurrect a stale progress bar
              setProgress(p);
              timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
            },
            onFileFullySent: () => {
              // Drop the file that just finished — whatever's left is what
              // a reconnect would need to send.
              checkpoint.bytesAlreadySent += checkpoint.remainingFiles[0].size;
              checkpoint.remainingFiles = checkpoint.remainingFiles.slice(1);
            },
            onAllComplete: () => {
              if (terminalRef.current) return;
              terminalRef.current = true;
              timingRef.current.end = performance.now();
              setPhase("done");
            },
            onError: (msg) => {
              // cancel() already flips terminalRef + phase synchronously —
              // this callback firing afterwards (the abort unwinding through
              // sendFiles' catch block) must not clobber that with an
              // "error" state appearing after the fact. That's what made
              // Cancel feel broken: the button worked immediately, but a
              // stray late error overwrote the UI a moment later.
              if (terminalRef.current) return;
              terminalRef.current = true;
              setError(msg);
              setPhase("error");
            },
          },
          {
            totalFiles: checkpoint.totalFiles,
            totalBytes: checkpoint.totalBytes,
            bytesAlreadySent: checkpoint.bytesAlreadySent,
          },
          maxMessageSize,
          abortControllerRef.current?.signal,
        );
      };

      const establishAndRun = async () => {
        setPhase("connecting");

        // Tell the receiver exactly how many RTCPeerConnections to expect,
        // so it doesn't have to eagerly open MAX_PARALLEL_CONNECTIONS and
        // prune the unused ones (see multi-peer.ts / README "Known
        // limitations" — this closes that gap).
        // Only use the 4x parallel connections if the person manually
        // checked the box before clicking Send — otherwise a single
        // connection, same as before.
        const connectionCount = parallelMode ? MAX_PARALLEL_CONNECTIONS : 1;
        signaling.send({
          type: "CONFIG",
          role: "sender",
          payload: { connectionCount },
        });

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return; // already done/errored — nothing to resume
          const remaining = resumeRef.current?.remainingFiles.length ?? 0;
          if (remaining === 0) return; // already finished — nothing to resume
          void attemptReconnect();
        };

        if (connectionCount > 1) {
          const { peers, channels } = await establishParallelSenderConnections(
            signaling,
            connectionCount,
            { onConnectionStateChange },
            undefined,
            getIceServers(turnOverride),
          );
          peersRef.current = peers;
          if (channels.length === 0) {
            terminalRef.current = true;
            setError("Failed to establish any parallel connection.");
            setPhase("error");
            return;
          }
          runTransfer(channels, peers[0]);
        } else {
          const peer = new PeerConnection(
            "sender",
            signaling,
            {
              onDataChannelOpen: (channel) => runTransfer([channel], peer),
              onConnectionStateChange,
            },
            undefined,
            getIceServers(turnOverride),
          );
          peersRef.current = [peer];
          void peer.initiate();
        }
      };

      const attemptReconnect = async () => {
        if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
          terminalRef.current = true;
          setError("Connection lost and could not be re-established.");
          setPhase("error");
          return;
        }
        const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
        reconnectAttemptRef.current++;
        setPhase("reconnecting");
        statsRef.current?.stop();
        peersRef.current.forEach((p) => p.close());
        peersRef.current = [];
        await new Promise((r) => setTimeout(r, delay));

        // Full signaling-reconnect: if the WebSocket itself also dropped
        // (not just the RTCPeerConnection — a Wi-Fi hiccup or brief NAT
        // rebinding usually only kills the latter), rebuild it against the
        // same room. The room (and its code) outlives a single socket
        // disconnect on the Durable Object side — see room.ts — so this is
        // safe to retry as long as the room hasn't hit its own TTL.
        if (!signaling.isConnected()) {
          signaling.close();
          signaling = new SignalingClient(room.code, "sender");
          signalingRef.current = signaling;
          try {
            await signaling.connect();
          } catch {
            terminalRef.current = true;
            setError("Lost connection to the pairing server and could not reconnect.");
            setPhase("error");
            return;
          }
          attachTopLevelHandlers(signaling);
          // Don't call establishAndRun() directly here — the room's
          // Durable Object only sends PEER_JOINED once it can confirm the
          // receiver's socket is also present (room.ts's
          // handleWebSocketUpgrade). If the receiver is already connected,
          // that PEER_JOINED arrives immediately and attachTopLevelHandlers
          // (just re-registered above) picks it up and calls
          // establishAndRun for us. If the receiver is *also* mid-reconnect,
          // this just waits for their socket to show up — trying to
          // establish a WebRTC offer before the room can confirm a
          // receiver is listening would silently go nowhere.
          setPhase("waiting");
          return;
        }

        void establishAndRun();
      };

      attachTopLevelHandlers(signaling);
    } catch (err) {
      terminalRef.current = true;
      setError(err instanceof Error ? err.message : "Failed to start transfer");
      setPhase("error");
    }
  };

  const cancel = () => {
    // Order matters: flip terminalRef *before* aborting/cleaning up, so any
    // callback still unwinding from the in-flight sendFiles() promise sees
    // it and no-ops instead of overwriting the UI a moment later (that
    // delayed-looking "cancel didn't do anything, then something changes"
    // behavior was exactly this ordering bug).
    terminalRef.current = true;
    abortControllerRef.current?.abort();
    // Best-effort: tell the receiver right away instead of letting them
    // sit there until their own stall timeout fires.
    if (channelsRef.current[0]?.readyState === "open") {
      try {
        channelsRef.current[0].send(
          JSON.stringify({ type: "CANCEL", reason: "The sender cancelled the transfer." }),
        );
      } catch {
        // best effort only
      }
    }
    cleanup();
    setPhase("idle");
    setCode(null);
    setProgress(null);
  };

  const startStoreSend = async () => {
    if (files.length === 0) return;
    setError(null);
    setStorePhase("uploading");
    setStoreResult(null);
    try {
      const result = await uploadStored(
        files,
        { maxDownloads: 1, ttlMs: STORED_TRANSFER_DEFAULT_TTL_MS, appUrl: APP_URL },
        (p) => setStoreProgress(p),
      );
      setStoreResult(result);
      setStorePhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload");
      setStorePhase("error");
    }
  };

  const revokeStoreSend = async () => {
    if (!storeResult) return;
    await revokeStored(storeResult.id, storeResult.revokeToken).catch(() => {});
    setStorePhase("idle");
    setStoreResult(null);
    setStoreProgress(null);
    setFiles([]);
  };

  const isLocked = phase !== "idle";
  const isStoreLocked = storePhase !== "idle";

return (
  <div className="flex h-full flex-col justify-between" data-tour="send-panel">
    {/* TOP CONTENT WRAPPER */}
    <div className="flex-1">
      <div className="mb-4 flex items-center gap-3">
        <IconBox>
          <UploadIcon />
        </IconBox>
        <div className="mt-2 flex flex-col justify-center leading-snug">
          <h2 className="mb-2 ml-2 text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem]">
            Send
          </h2>
          <p className="ml-2 text-xs font-medium text-[#555555] leading-snug">
            Choose several files. Share one code.
          </p>
        </div>
      </div>

      {/* Direct / Store tabs */}
      <ModeTabs
        storeMode={storeMode}
        setStoreMode={setStoreMode}
        disabled={isLocked || isStoreLocked}
      />

      {storeMode ? (
        <StoreComingSoon />
      ) : (
        <>
          <label className="mb-4 flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={parallelMode}
              disabled={isLocked}
              onChange={(e) => setParallelMode(e.target.checked)}
              className="h-3.5 w-3.5 accent-ink"
            />
            Parallel connections ({MAX_PARALLEL_CONNECTIONS}x, experimental) — benchmark this against
            Direct before trusting it on your network
          </label>

          <div data-tour="file-dropzone">
            <FileDropzone
              files={files}
              disabled={isLocked}
              onFilesSelected={setFiles}
              onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </div>

          <div data-tour="code-area">
            {code && phase !== "idle" && (
              <div className="mt-4">
                <CodeDisplay code={code} browserLink={`${APP_URL}/?code=${code}`} />
              </div>
            )}

            {phase === "waiting" && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-muted">Waiting for recipient…</p>
                <IndeterminateBar />
              </div>
            )}

            {phase === "connecting" && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-muted">Opening encrypted data channels…</p>
                <IndeterminateBar />
              </div>
            )}

            {phase === "sending" && progress && (
              <div className="mt-4 space-y-3">
                <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
                <TransferProgress
                  label="Sending"
                  fileName={progress.fileName}
                  bytesTransferred={progress.bytesTransferred}
                  totalBytes={progress.totalBytes}
                  percent={(progress.bytesTransferred / progress.totalBytes) * 100}
                  ratePerSec={progress.ratePerSec}
                  etaSeconds={progress.etaSeconds}
                  fileIndex={progress.fileIndex}
                  totalFiles={progress.totalFiles}
                  windowBytes={progress.windowBytes}
                />
              </div>
            )}

            {phase === "reconnecting" && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-warn">
                  Connection dropped — attempting to reconnect and resume…
                </p>
                <IndeterminateBar />
                {progress && (
                  <p className="text-[11px] text-muted">
                    {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already sent —
                    resuming from there, not from zero.
                  </p>
                )}
              </div>
            )}

            {phase === "done" && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-medium text-accent">
                  ✓ Transfer complete — {formatBytes(files.reduce((s, f) => s + f.size, 0))} sent.
                </p>
                <BenchmarkSummary
                  totalBytes={files.reduce((s, f) => s + f.size, 0)}
                  durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
                  avgBytesPerSec={
                    files.reduce((s, f) => s + f.size, 0) /
                    ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
                  }
                  peakBytesPerSec={timingRef.current.peakBps}
                  connectionType={connStats.type}
                  rttMs={connStats.rttMs}
                  finalWindowBytes={progress?.windowBytes}
                />
              </div>
            )}

            {phase === "error" && error && (
              <p className="mt-4 text-xs font-medium text-warn">{error}</p>
            )}
          </div>
        </>
      )}
    </div>

    {/* BOTTOM BUTTON CONTAINER */}
    <div className="mt-auto pt-6">
      <p className="mb-2 text-[11px] text-[#6e6a61]">
        Signaling only. Files travel peer-to-peer via WebRTC.
      </p>

      {storeMode ? (
        <button
          type="button"
          disabled
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#575656] opacity-70 cursor-not-allowed"
        >
          <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
            <SketchedBackground mode="outline" />
          </div>
          <span className="relative z-10">🚧 Coming soon</span>
        </button>
      ) : !isLocked ? (
        <button
          type="button"
          onClick={startSend}
          disabled={files.length === 0}
          data-tour="send-button"
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
            <SketchedBackground mode={files.length > 0 ? "dark" : "light"} />
          </div>
          <span className="relative z-10 flex items-center gap-2" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>
            <UploadIcon color="#fff"/> Send file
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={cancel}
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
        >
          <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
            <SketchedBackground mode="outline" />
          </div>
          <span className="relative z-10 flex items-center gap-2">
             Cancel send
          </span>
        </button>
      )}
    </div>

    {/* TODO: Desktop & mobile app download links go here, right under the
        Send button — same spot referenced in the "Desktop & mobile, on the
        way" tutorial step (components/tutorial-modal.tsx). */}

    {/* <div className="mt-2 w-full sm:hidden">
      <img
        src="/best-cat.png" // replace with your image path
        alt=""
        draggable={false}
        className="w-full h-auto object-contain pointer-events-none select-none"
      />
    </div> */}

  </div>
);
}

// ---------------------------------------------------------------------------
// Receive panel
// ---------------------------------------------------------------------------

function ReceivePanel({
  turnOverride,
  initialCode,
}: {
  turnOverride: TurnOverride | null;
  initialCode?: string | null;
}) {
  const [codeInput, setCodeInput] = useState("");

  // Prefill from a shared receive link (see HomePage's initialCode effect
  // — reads `?code=` from the URL and hands it down here).
  useEffect(() => {
    if (initialCode) setCodeInput(initialCode);
  }, [initialCode]);
  const [phase, setPhase] = useState<ReceivePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receivedFile, setReceivedFile] = useState<File | null>(null);
  const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
    type: "unknown",
    rttMs: null,
  });
  const [storePhase, setStorePhase] = useState<
    "idle" | "loading" | "review" | "downloading" | "done" | "error"
  >("idle");
  const [storeManifest, setStoreManifest] = useState<StoredManifest | null>(null);
  const [storeDownloadProgress, setStoreDownloadProgress] = useState<StoreDownloadProgress | null>(
    null,
  );
  const storeKeysRef = useRef<{ id: string; keys: Awaited<ReturnType<typeof deriveKeys>> } | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const peersRef = useRef<any[]>([]);
  const receiverRef = useRef<FileReceiver | null>(null);
  const statsRef = useRef<StatsMonitor | null>(null);
  const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
    start: 0,
    end: 0,
    peakBps: 0,
  });
  const reconnectAttemptRef = useRef(0);
  const terminalRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const phaseRef = useRef<ReceivePhase>("idle"); // mirrors `phase` for use inside stable callbacks (e.g. the signaling close handler) that shouldn't go stale

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const cleanup = useCallback(() => {
    statsRef.current?.stop();
    peersRef.current.forEach((p) => p.close());
    signalingRef.current?.close();
    statsRef.current = null;
    peersRef.current = [];
    signalingRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const STALL_TIMEOUT_MS = 45_000;
  useEffect(() => {
    if (phase !== "connecting" && phase !== "receiving" && phase !== "verifying" && phase !== "reconnecting") return;
    lastActivityRef.current = Date.now();
    const interval = setInterval(() => {
      if (terminalRef.current) return;
      if (Date.now() - lastActivityRef.current > STALL_TIMEOUT_MS) {
        terminalRef.current = true;
        cleanup();
        setError("No response from the sender for a while — the connection may have been lost.");
        setPhase("error");
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [phase, cleanup]);

  const startReceive = async () => {
    const input = codeInput.trim();
    if (!input) return;
    const parsed = parseShareLink(input);
    if (parsed) {
      await startStoreReceive(parsed.id, parsed.masterKey);
    } else {
      await startLiveReceive(input);
    }
  };

  const startStoreReceive = async (id: string, masterKey: Uint8Array) => {
    setError(null);
    setStorePhase("loading");
    try {
      const status = await fetchStoredStatus(id);
      if (status.status !== "available") {
        setError(
          status.status === "uploading"
            ? "This transfer hasn't finished uploading yet."
            : `This transfer is ${status.status}.`,
        );
        setStorePhase("error");
        return;
      }
      const keys = await deriveKeys(masterKey);
      const manifest = await fetchStoredManifest(id, keys);
      setStoreManifest(manifest);
      setStorePhase("review");
      storeKeysRef.current = { id, keys };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this stored transfer.");
      setStorePhase("error");
    }
  };

  const confirmStoreDownload = async () => {
    if (!storeManifest || !storeKeysRef.current) return;
    setStorePhase("downloading");
    try {
      const files = await downloadStoredFiles(
        storeKeysRef.current.id,
        storeKeysRef.current.keys,
        storeManifest,
        (p) => setStoreDownloadProgress(p),
      );
      files.forEach(downloadFile);
      setStorePhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
      setStorePhase("error");
    }
  };

  const startLiveReceive = async (code: string) => {
    setError(null);
    setPhase("connecting");
    reconnectAttemptRef.current = 0;
    terminalRef.current = false;

    try {
      const status = await checkRoom(code);
      if (!status.exists) {
        setError(status.expired ? "This code has expired." : "That code doesn't exist.");
        setPhase("error");
        return;
      }

      let signaling = new SignalingClient(code, "receiver");
      signalingRef.current = signaling;
      await signaling.connect();

      // Same rationale as the sender side: an idle signaling socket can die
      // silently mid-handshake (waiting on CONFIG / the offer) without ever
      // firing a close event. Only step in here, before a peer connection
      // exists — once WebRTC is up, onConnectionStateChange below owns
      // recovery.
      signaling.onClose(() => {
        if (terminalRef.current) return;
        if (phaseRef.current !== "connecting") return;
        void attemptReconnect();
      });

      receiverRef.current = new FileReceiver({
        onProgress: (p) => {
          if (terminalRef.current) return;
          lastActivityRef.current = Date.now();
          setPhase((prev) => (prev === "done" ? prev : "receiving"));
          setProgress(p);
          timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
        },
        onVerifying: () => {
          if (terminalRef.current) return;
          // All bytes are in — reassembling + hashing a large file takes
          // real, visible time. Without this the UI just sat at 100% with
          // nothing changing, which looked exactly like a frozen/failed
          // download even though it was working.
          lastActivityRef.current = Date.now();
          setPhase("verifying");
        },
        onFileComplete: (file) => {
          setReceivedFile(file);
          downloadFile(file);
        },
        onAllComplete: () => {
          if (terminalRef.current) return;
          terminalRef.current = true;
          timingRef.current.end = performance.now();
          setPhase("done");
        },
        onError: (msg) => {
          // See the matching comment in SendPanel's cancel(): terminalRef
          // is set synchronously by cancel() before anything async unwinds,
          // so a cancellation-triggered error arriving here is expected and
          // must not overwrite the "idle" state the user already sees.
          if (terminalRef.current) return;
          terminalRef.current = true;
          setError(msg);
          setPhase("error");
        },
      });

      const establishAndListen = async () => {
        const connectionCount = await waitForConfig(signaling, MAX_PARALLEL_CONNECTIONS, 3000);

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return;
          void attemptReconnect();
        };

        let statsStarted = false;
        const { peers, channels } = await establishParallelReceiverConnections(
          signaling,
          connectionCount,
          {
            onConnectionStateChange,
            onDataChannelOpen: (channel, peer) => {
              if (peer.getConnectionIndex() === 0) {
                receiverRef.current?.setControlChannel(channel);
              }
              if (!statsStarted) {
                statsStarted = true;
                statsRef.current?.stop();
                if (timingRef.current.start === 0) {
                  timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
                }
                const stats = new StatsMonitor(
                  () => peer.getStats(),
                  (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
                );
                stats.start();
                statsRef.current = stats;
              }
              channel.addEventListener("message", (event) => {
                receiverRef.current?.handleMessage(event.data);
              });
            },
          },
          undefined,
          getIceServers(turnOverride),
        );
        peersRef.current = peers;

        if (channels.length === 0 && !terminalRef.current) {
          setError("No connection from the sender arrived. Check the code and try again.");
          setPhase("error");
        }
      };

      const attemptReconnect = async () => {
        if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
          terminalRef.current = true;
          setError("Connection lost and could not be re-established.");
          setPhase("error");
          return;
        }
        const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
        reconnectAttemptRef.current++;
        setPhase("reconnecting");
        statsRef.current?.stop();
        peersRef.current.forEach((p) => p.close());
        peersRef.current = [];
        await new Promise((r) => setTimeout(r, delay));

        if (!signaling.isConnected()) {
          signaling.close();
          signaling = new SignalingClient(code, "receiver");
          signalingRef.current = signaling;
          try {
            await signaling.connect();
          } catch {
            terminalRef.current = true;
            setError("Lost connection to the pairing server and could not reconnect.");
            setPhase("error");
            return;
          }
          signaling.onClose(() => {
            if (terminalRef.current) return;
            if (phaseRef.current !== "connecting") return;
            void attemptReconnect();
          });
        }
        void establishAndListen();
      };

      await establishAndListen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join transfer");
      setPhase("error");
    }
  };

  const cancel = () => {
    // Same ordering fix as SendPanel: flip terminalRef before tearing
    // anything down so a callback still unwinding from an in-flight
    // handleMessage/finishCurrentFile call sees it and no-ops.
    terminalRef.current = true;
    receiverRef.current?.notifyCancel("The receiver cancelled the transfer.");
    cleanup();
    setPhase("idle");
    setProgress(null);
    setCodeInput("");
  };

  const isLocked = phase !== "idle";
  const isStoreLocked = storePhase !== "idle";
  const anyLocked = isLocked || isStoreLocked;

return (
  <div className="flex h-full flex-col justify-between" data-tour="receive-panel">
    {/* TOP CONTENT WRAPPER */}
    <div className="flex-1">
      {/* Header — Matched to SendPanel */}
      <div className="mb-4 flex items-center gap-3">
        <IconBox>
          <DownloadIcon />
        </IconBox>
        <div className="mt-2 flex flex-col justify-center leading-snug">
          <h2 className="mb-2 ml-2 text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem]">
            Receive
          </h2>
          <p className="ml-2 text-xs font-medium text-[#555555] leading-snug">
            Enter a code. Review before saving.
          </p>
        </div>
      </div>

      {/* Code Input Field */}
      <div className="mb-2">
  <label className="mb-2 mt-3 block text-[12px] font-thin uppercase tracking-wider text-[#6e6a61]">
    Code
  </label>
  
  {/* Relative wrapper with explicit overflow-visible */}
  <div className="relative z-0 overflow-visible rounded-[6px] bg-[#f4f2eb]/70 p-1" data-tour="receive-input">
    
    {/* Sleeping Cat Image - Higher Z-Index & Clean Positioning */}
    <img
      src="/sleeping-cat.png"
      alt=""
      draggable={false}
      className="pointer-events-none absolute -top-[36px] right-3 z-30 h-12 w-auto select-none sm:hidden"
    />

    <div className="relative">
      <div className="pointer-events-none absolute inset-0 rounded-md border border-[#2b2b2b]/30" />

      <input
        className="relative z-10 h-8 w-full rounded-md bg-transparent px-2 text-[12px] font-normal text-[#101010] outline-none placeholder:font-normal placeholder:text-[#9c9b98] disabled:opacity-50"
        placeholder="word-word-word or a stored link"
        value={codeInput}
        disabled={anyLocked}
        onChange={(e) => setCodeInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && startReceive()}
      />
    </div>
  </div>
</div>
      <p className="m-1 text-[12px] font-medium leading-5 text-[#494946]">
        Paste a live code (word-word-word) or a stored transfer link, then press Enter or select Receive.
      </p>

      {/* Progress / Status States */}
      {phase === "connecting" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
          <IndeterminateBar />
        </div>
      )}

      {phase === "receiving" && progress && (
        <div className="mt-4 space-y-3">
          <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
          <TransferProgress
            label="Receiving"
            fileName={progress.fileName}
            bytesTransferred={progress.bytesTransferred}
            totalBytes={progress.totalBytes}
            percent={(progress.bytesTransferred / progress.totalBytes) * 100}
            ratePerSec={progress.ratePerSec}
            etaSeconds={progress.etaSeconds}
            fileIndex={progress.fileIndex}
            totalFiles={progress.totalFiles}
          />
        </div>
      )}

      {phase === "verifying" && (
        <div className="mt-4 space-y-2">
          <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
          <p className="text-xs font-medium text-[#625e55]">
            All bytes received — verifying file integrity…
          </p>
          <IndeterminateBar />
          {progress && (
            <p className="text-[11px] font-medium text-[#625e55]">
              {formatBytes(progress.totalBytes)} received. This can take a moment on large files —
              it isn't stuck.
            </p>
          )}
        </div>
      )}

      {phase === "reconnecting" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-[#a84232]">
            Connection dropped — attempting to reconnect and resume…
          </p>
          <IndeterminateBar />
          {progress && (
            <p className="text-[11px] font-medium text-[#625e55]">
              {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already
              received — resuming from there, not from zero.
            </p>
          )}
        </div>
      )}

      {phase === "done" && receivedFile && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-[#1b5e20]">
            ✓ All files received and verified — {receivedFile.name}
          </p>
          <BenchmarkSummary
            totalBytes={receivedFile.size}
            durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
            avgBytesPerSec={
              receivedFile.size / ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
            }
            peakBytesPerSec={timingRef.current.peakBps}
            connectionType={connStats.type}
            rttMs={connStats.rttMs}
          />
        </div>
      )}

      {phase === "error" && error && !isStoreLocked && (
        <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
      )}

      {/* --- Stored (async) transfer flow --- */}

      {storePhase === "loading" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
          <IndeterminateBar />
        </div>
      )}

      {storePhase === "review" && storeManifest && (
        <div className="relative mt-4 rounded-[6px] bg-[#f4f2eb]/70 p-3 text-[#181818]">
          <div
            className="pointer-events-none absolute inset-0 rounded-[6px] border border-[#a09c93]"
            style={{ filter: "url(#pencil-rough)" }}
          />
          <div className="relative z-10 mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6e6a61]">
            <span>Incoming transfer</span>
            <span>{formatBytes(storeManifest.totalSize)}</span>
          </div>
          <ul className="relative z-10 mb-3 divide-y divide-[#d4d0c5] border-y border-[#d4d0c5]">
            {storeManifest.files.map((f) => (
              <li key={f.name} className="flex items-center justify-between py-1.5 text-xs font-medium">
                <span className="truncate text-[#101010]">{f.name}</span>
                <span className="shrink-0 text-[#625e55]">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <div className="relative z-10 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStorePhase("idle");
                setStoreManifest(null);
                setCodeInput("");
              }}
              className="relative flex h-10 flex-1 items-center justify-center font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
            >
              <div
                className="absolute inset-0 z-0 h-full w-full overflow-hidden"
                style={{ filter: "url(#pencil-rough)" }}
              >
                <SketchedBackground mode="outline" />
              </div>
              <span className="relative z-10 text-xs">Refuse</span>
            </button>
            <button
              type="button"
              onClick={confirmStoreDownload}
              className="relative flex h-10 flex-1 items-center justify-center gap-1.5 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer"
            >
              <div
                className="absolute inset-0 z-0 h-full w-full overflow-hidden"
                style={{ filter: "url(#pencil-rough)" }}
              >
                <SketchedBackground mode="dark" />
              </div>
              <span
                className="relative z-10 flex items-center gap-1.5 text-xs"
                style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
              >
                <DownloadIcon color="#fff" /> Download
              </span>
            </button>
          </div>
        </div>
      )}

      {storePhase === "downloading" && storeDownloadProgress && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Downloading and decrypting…</p>
          <div
            className="relative h-2.5 w-full overflow-hidden rounded-[4px] border border-[#7a766c] bg-[#eae7df]"
            style={{ filter: "url(#pencil-rough)" }}
          >
            <div
              className="h-full bg-[#181818] transition-all duration-200 ease-out"
              style={{
                width: `${Math.min(
                  100,
                  (storeDownloadProgress.bytesDownloaded / storeDownloadProgress.totalBytes) * 100,
                )}%`,
              }}
            />
          </div>
          <p className="text-[11px] font-medium text-[#625e55]">
            {formatBytes(storeDownloadProgress.bytesDownloaded)} / {formatBytes(storeDownloadProgress.totalBytes)}
          </p>
        </div>
      )}

      {storePhase === "done" && storeManifest && (
        <p className="mt-4 text-xs font-bold text-[#1b5e20]">
          ✓ All files verified and downloaded — {storeManifest.files.length} file
          {storeManifest.files.length === 1 ? "" : "s"}.
        </p>
      )}

      {storePhase === "error" && error && (
        <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
      )}
    </div>

    {/* BOTTOM BUTTON CONTAINER */}
    <div className="mt-auto pt-6">
      <p className="mb-2 text-right text-[11px] text-[#6e6a61]">
        STUN only — no relay fallback by default.
      </p>

      {!anyLocked ? (
        <button
          type="button"
          onClick={startReceive}
          disabled={!codeInput.trim()}
          data-tour="receive-button"
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
        >
          <div
            className="absolute inset-0 z-0 h-full w-full overflow-hidden"
            style={{ filter: "url(#pencil-rough)" }}
          >
            <SketchedBackground mode={codeInput.trim() ? "dark" : "light"} />
          </div>
          <span
            className="relative z-10 flex items-center gap-2"
            style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
          >
            <DownloadIcon color="#fff" /> Receive
          </span>
        </button>
      ) : isStoreLocked && storePhase !== "review" ? (
        <button
          type="button"
          onClick={() => {
            setStorePhase("idle");
            setStoreManifest(null);
            setCodeInput("");
          }}
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
        >
          <div
            className="absolute inset-0 z-0 h-full w-full overflow-hidden"
            style={{ filter: "url(#pencil-rough)" }}
          >
            <SketchedBackground mode="outline" />
          </div>
          <span className="relative z-10 flex items-center gap-2">
            <CloseIcon /> {storePhase === "done" ? "Done" : "Cancel"}
          </span>
        </button>
      ) : isLocked ? (
        <button
          type="button"
          onClick={cancel}
          className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
        >
          <div
            className="absolute inset-0 z-0 h-full w-full overflow-hidden"
            style={{ filter: "url(#pencil-rough)" }}
          >
            <SketchedBackground mode="outline" />
          </div>
          <span className="relative z-10 flex items-center gap-2">
            <CloseIcon /> Cancel receive
          </span>
        </button>
      ) : null}
    </div>

    {/* TODO: Desktop & mobile app download links go here, right under the
        Receive button — same spot referenced in the "Desktop & mobile, on
        the way" tutorial step (components/tutorial-modal.tsx). */}
  </div>
);
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function IndeterminateBar() {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-[3px] bg-[#eae7df]">
      {/* Smooth border */}
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[3px] border border-[#7a766c]" />

      {/* Animated charcoal bar */}
      <div
        className="h-full w-1/3 animate-[sketch-slide_1.5s_ease-in-out_infinite] rounded-[2px] bg-[#181818]"
      />

      <style jsx>{`
        @keyframes sketch-slide {
          0% {
            transform: translateX(-100%);
          }

          100% {
            transform: translateX(300%);
          }
        }
      `}</style>
    </div>
  );
}

function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#050505]/70 bg-transparent">
      {children}
    </div>
  );
}

function UploadIcon({ color = "#3B3B3C" }: { color?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon({ color = "#3B3B3C" }: { color?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v12M6 10l6 6 6-6" />
      <path d="M4 20h16" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}