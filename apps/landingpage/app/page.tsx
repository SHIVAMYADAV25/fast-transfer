'use client';

import React, { useState, useEffect, useRef } from 'react';
import rough from 'roughjs/bin/rough';

// ----------------------------------------------------------------------
// 1. CANVAS ANNOTATIONS OVERLAY
// ----------------------------------------------------------------------
const RoughAnnotations = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const rc = rough.canvas(canvas);
    rc.line(140, 48, 230, 51, { stroke: '#18181b', strokeWidth: 1.8, roughness: 1.8 });
    rc.line(45, 680, 135, 685, { stroke: '#18181b', strokeWidth: 1.5, roughness: 2 });
    rc.line(880, 680, 960, 685, { stroke: '#18181b', strokeWidth: 1.5, roughness: 2 });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={1200}
      height={800}
      className="absolute inset-0 pointer-events-none z-10 w-full h-full hidden lg:block"
    />
  );
};

// ----------------------------------------------------------------------
// 2. HAND-DRAWN SKETCHY SVG ICONS (Scalable via Tailwind classes)
// ----------------------------------------------------------------------
const GlobeIcon = ({ className = "w-6 h-6 lg:w-6 lg:h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 20,4.2 C 11.5,3.9 3.8,11.2 4,20 C 4.2,28.8 11.3,36 20,35.8 C 28.6,35.7 36,28.6 35.8,20 C 35.7,11.3 28.5,4.3 20,4.2 Z" />
    <path d="M 19.5,4.8 C 12,4.8 5,12 5.2,19.8 C 5.3,27.5 12,35 19.8,35 C 27.5,35 34.8,27.8 35,20 C 35,12.5 27.5,5 19.5,4.8 Z" strokeWidth="1" opacity="0.5" />
    <path d="M 4.2,20 C 12.5,19.4 27.5,20.6 35.8,20" />
    <path d="M 7,12 C 14.5,14.2 25.5,14 33,12" />
    <path d="M 7,28 C 14.2,25.8 25.8,26.2 33,28" />
    <path d="M 20,4 C 13.8,10.2 12.8,29.8 20,36" />
    <path d="M 20,4 C 26.2,10.2 27.2,29.8 20,36" />
  </svg>
);

const PhoneIcon = ({ className = "w-5 h-6 lg:w-5 lg:h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 32 42" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 9,3 C 6.2,3.1 4.8,5.2 4.9,8.2 L 5,33.8 C 5.1,36.8 6.9,39 9.5,39 L 22.5,39 C 25.2,38.9 27,36.8 27.1,33.8 L 27,8.2 C 26.9,5.2 25.1,3.1 22.5,3 Z" />
    <path d="M 9.5,3.6 L 22,3.6 C 24.5,3.8 26.2,5.5 26.2,8 L 26.2,34 C 26,36.2 24.5,38.2 22,38.2 L 9.8,38.2 C 7.2,38 5.8,36 5.8,33.8 Z" strokeWidth="1" opacity="0.4" />
    <path d="M 13,7 C 16,6.7 19,7.3 19,7" />
    <circle cx="16" cy="34.8" r="1.5" strokeWidth="2" fill="currentColor" />
    <path d="M 8,10 L 24,10 L 24,30.5 L 8,30.5 Z" strokeWidth="1" strokeDasharray="3 2" opacity="0.3" />
  </svg>
);

const DesktopIcon = ({ className = "w-6 h-6 lg:w-6 lg:h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 42 38" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 6,5 C 3.8,5.2 3,7.2 3,9.8 L 3,24.2 C 3,26.8 4.6,28.5 7,28.5 L 35,28.5 C 37.6,28.5 39,26.8 39,24.2 L 39,9.8 C 39,7.2 37.4,5 35,5 Z" />
    <path d="M 17,28.5 L 15.2,34.5" />
    <path d="M 25,28.5 L 26.8,34.5" />
    <path d="M 11,34.5 C 18,33.8 24,35.2 31,34.5" strokeWidth="3" />
    <path d="M 6.5,8.8 L 35.5,8.8 L 35.5,24.8 L 6.5,24.8 Z" strokeWidth="1" opacity="0.35" />
  </svg>
);

const HandArrow = ({ className = "w-5 h-5 lg:w-4 lg:h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 3,12 C 8.5,11.5 14.2,12.3 19.5,12" />
    <path d="M 13.5,6.5 C 16.2,8.8 18.2,10.5 20,12 C 18.2,13.8 16,15.8 13.5,18" />
  </svg>
);

// Organic double-drawn sketchy ink border
const SketchyBorder = ({ color = "#18181b", variant = "default" }: { color?: string; variant?: string | number }) => {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" preserveAspectRatio="none" viewBox="0 0 260 110">
      <defs>
        <filter id={`sketchFilter-${variant}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      <g filter={`url(#sketchFilter-${variant})`}>
        {/* Pass 1: Primary Outline */}
        <path
          d="M 16,6 C 70,3.8 190,7 242,5 C 253,6 255,14 254,24 C 256,50 253,80 255,95 C 254,104 245,105 235,104.5 C 170,106 80,103.5 18,105 C 7,104 5,96 6,85 C 4,60 7,30 5,16 C 6,7 11,5.5 16,6 Z"
          fill="none"
          stroke={color}
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />

        {/* Pass 2: Uneven Overlap */}
        <path
          d="M 22,5 C 90,7 180,4.2 238,7 C 254,8.2 253,20 255,35 C 253,60 256,82 254,92 C 252,103 240,104 220,105 C 150,103 60,106 25,104 C 8,103 6,90 7,75 C 5,50 6,25 7,12 C 8,5 14,6 22,5 Z"
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.75"
        />

        {/* Pass 3: Corner Accents */}
        <path d="M 12,15 C 8,12 10,8 18,8" fill="none" stroke={color} strokeWidth="2.5" opacity="0.6" />
        <path d="M 245,15 C 250,22 252,30 251,40" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
        <path d="M 248,90 C 242,100 230,102 215,103" fill="none" stroke={color} strokeWidth="2.8" opacity="0.6" />
        <path d="M 18,98 C 10,95 8,88 8,80" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
      </g>
    </svg>
  );
};

// ----------------------------------------------------------------------
// 3. HAND-DRAWN BUTTON COMPONENT
// ----------------------------------------------------------------------
interface HandDrawnButtonProps {
  icon: React.ReactNode;
  title: string;
  subtext?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  fontFamily?: string;
  showTexture?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const HandDrawnButton = ({
  icon,
  title,
  subtext,
  bgColor = "#C4BEED",
  textColor = "#1c1917",
  borderColor = "#18181b",
  fontFamily = "'Patrick Hand', cursive",
  showTexture = true,
  onClick,
  className = "",
  style = {}
}: HandDrawnButtonProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  return (
    <div className={`inline-flex flex-col items-center select-none w-full lg:w-auto ${className}`} style={{ fontFamily, ...style }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsPressed(false);
        }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        aria-label={typeof title === 'string' ? title.replace('\n', ' ') : 'Hand drawn button'}
        className="relative group cursor-pointer border-none bg-transparent p-0 outline-none focus:outline-none transition-transform duration-200 ease-out w-full lg:w-auto"
        style={{
          transform: isPressed
            ? 'scale(0.97) translateY(2px) rotate(-0.5deg)'
            : isHovered
            ? 'scale(1.03) translateY(-3px) rotate(0.8deg)'
            : 'scale(1) translateY(0px) rotate(0deg)',
        }}
      >
        {/* Soft Shadow */}
        <div
          className="absolute inset-0 transition-all duration-200 pointer-events-none"
          style={{
            backgroundColor: '#18181b',
            opacity: isHovered ? 0.22 : 0.12,
            transform: isHovered ? 'translate(4px, 5px)' : 'translate(3px, 4px)',
            borderRadius: '18px 16px 20px 15px',
            filter: 'blur(1px)'
          }}
        />

        {/* Inner Filled Container */}
        <div
          className="relative px-5 py-3 lg:px-3.5 lg:py-2.5 w-full lg:w-auto min-w-[170px] sm:min-w-[190px] min-h-[72px] lg:min-h-[62px] flex items-center justify-between gap-3 lg:gap-2.5 transition-colors duration-200 overflow-hidden"
          style={{
            backgroundColor: bgColor,
            color: textColor,
            clipPath: 'polygon(2% 4%, 97% 2%, 99% 95%, 4% 98%)',
            borderRadius: '14px 18px 12px 16px',
          }}
        >
          {showTexture && (
            <div 
              className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay"
              style={{
                backgroundImage: `radial-gradient(#000 1px, transparent 0)`,
                backgroundSize: '5px 5px'
              }}
            />
          )}

          <div className="flex-shrink-0 text-stone-900 flex items-center justify-center transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3">
            {icon}
          </div>

          <div className="flex-grow text-left leading-tight font-bold lg:font-semibold text-xl lg:text-lg tracking-wide whitespace-pre-line py-0.5">
            {title}
          </div>

          <div className="flex-shrink-0 text-stone-900 ml-0.5 transition-transform duration-200 group-hover:translate-x-1.5">
            <HandArrow />
          </div>

          <SketchyBorder color={borderColor} variant={title ? title.length : 'default'} />
        </div>
      </button>

      {subtext && (
        <span 
          className="mt-1.5 lg:mt-1 text-stone-800 text-base lg:text-sm tracking-wide opacity-90 transition-opacity duration-200"
          style={{ fontFamily }}
        >
          {subtext}
        </span>
      )}
    </div>
  );
};

const SketchyXIcon = () => (
  <svg className="w-5 h-5 text-stone-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 4.5 4.5 L 19.5 19.5" />
    <path d="M 19.5 4.5 L 4.5 19.5" />
    <path d="M 7 4.5 L 19.5 17" opacity="0.6" strokeWidth="1.5" />
  </svg>
);

const SketchyLinkedInIcon = () => (
  <svg className="w-6 h-6 text-stone-900" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 4 5 C 3.5 8 3.8 20 4 23 C 7 23.5 20 23.2 23 23 C 23.5 19 23.2 7 23 4 C 19 3.8 7 3.5 4 5 Z" />
    <path d="M 8 11 L 8 18" strokeWidth="2.5" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <path d="M 13 18 L 13 11 L 17 11 C 18.5 11 19.5 12 19.5 13.5 L 19.5 18" strokeWidth="2.3" />
  </svg>
);

export default function KimoLandingPage() {
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Caveat:wght@600;700&family=Kalam:wght@400;700&family=Patrick+Hand&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full bg-[#F6F3EC] text-stone-900 font-['Patrick_Hand',cursive] overflow-hidden flex flex-col justify-between px-6 py-4 md:px-8 md:py-6 selection:bg-purple-200">

      {/* NAVBAR */}
      <header className="relative z-20 flex justify-between items-center w-full max-w-7xl mx-auto px-4 py-1 select-none">
        <div className="flex items-center">
          <span className="text-[40px] font-bold tracking-tight text-stone-900 font-['Patrick_Hand',cursive] leading-none">
            kimo
          </span>
          <svg className="w-7 h-7 mt-3 text-stone-900 pointer-events-none" viewBox="0 -2 29 39" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
            <path d="M 7 6 L 18 -1" />
            <path d="M 9 16 L 20 15" />
            <path d="M 6 26 L 17 31" />
          </svg>
        </div>

        <nav className="flex items-center gap-3 sm:gap-4 text-stone-900 font-['Patrick_Hand',cursive] text-xl sm:text-xl">
          <a href="#blog" className="hover:opacity-75 transition-opacity">Blog</a>
          <span className="text-stone-400 font-light text-base">|</span>
          <a href="https://x.com/shivamdotdev" target="_blank" className="p-0.5 hover:scale-105 transition-transform" aria-label="X">
            <SketchyXIcon />
          </a>
          <span className="text-stone-400 font-light text-base">|</span>
          <a href="https://www.linkedin.com/in/shivamdotdev" target="_blank" className="p-0.5 hover:scale-105 transition-transform" aria-label="LinkedIn">
            <SketchyLinkedInIcon />
          </a>
        </nav>
      </header>

      {/* HERO MAIN SECTION */}
      <main className="relative z-10 w-full max-w-[1200px] mx-auto flex flex-col lg:flex-row items-center lg:justify-between my-auto py-2 overflow-visible">
        
        {/* LEFT COLUMN: HERO TEXT & BUTTONS */}
        <div className="w-full lg:w-auto flex flex-col items-start gap-3 px-1 sm:pl-2 shrink-0 z-10">
          
          {/* Subtitle / Catchphrase */}
          <div className="relative inline-block -rotate-[3deg] select-none mb-7">
            <p 
              className="text-xl md:text-[22px] text-stone-900 font-['Patrick_Hand',cursive] font-medium leading-none"
              style={{ wordSpacing: '0.18em', letterSpacing: '0.06em' }}
            >
              Big files. Small effort.
            </p>
            <svg 
              className="absolute -bottom-1.5 right-0 w-[54%] h-2.5 pointer-events-none overflow-visible -rotate-[1deg]" 
              viewBox="0 0 100 10" 
              fill="none" 
              preserveAspectRatio="none"
            >
              <path d="M 2 7 Q 50 3, 98 4" stroke="#18181b" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M 5 8 Q 50 4, 95 5" stroke="#18181b" strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            </svg>
          </div>

          {/* Title Block */}
          <div className="relative w-full max-w-[340px] sm:max-w-[400px] lg:max-w-[440px]">
            <svg viewBox="0 0 520 340" className="w-full h-auto overflow-visible">
              <defs>
                <filter id="brush-edge-texture" x="-20%" y="-20%" width="140%" height="140%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="4" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="displaced" />
                </filter>
                <filter id="highlight-blend" x="-10%" y="-20%" width="120%" height="140%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>

              <path
                d="M 5 282 Q 140 270, 348 276 Q 362 277, 356 305 Q 140 312, 0 304 Z"
                fill="#e8d5b7"
                opacity="0.85"
                filter="url(#highlight-blend)"
              />

              <g stroke="#121212" strokeWidth="4.5" strokeLinecap="round" filter="url(#brush-edge-texture)">
                <line x1="0" y1="52" x2="12" y2="68" />
                <line x1="-15" y1="92" x2="2" y2="86" />
                <line x1="2" y1="122" x2="12" y2="105" />
                <line x1="388" y1="230" x2="422" y2="200" />
                <line x1="406" y1="250" x2="438" y2="232" />
              </g>

              <g filter="url(#brush-edge-texture)" fill="#121212" style={{ fontFamily: '"Caveat", cursive', fontWeight: '700' }}>
                <text x="10" y="100" fontSize="110" letterSpacing="-1px">Share</text>
                <text x="15" y="202" fontSize="110" letterSpacing="-1px">Without</text>
                <text x="12" y="300" fontSize="112" letterSpacing="-1px">Limits.</text>
              </g>
            </svg>
          </div>

          {/* Paragraph Description */}
          <div className="text-base sm:text-lg text-stone-800 leading-6 max-w-md font-medium py-1">
            <p>Direct, encrypted, peer-to-peer file transfer.</p>
            <p className="mt-0.5">No sign up. No file size limits. Nothing touches our servers.</p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col lg:flex-row items-center justify-start gap-4 lg:gap-2.5 pt-2 w-full lg:w-auto">
            <HandDrawnButton
              icon={<GlobeIcon className="w-8 h-8 lg:w-5 lg:h-5" />}
              title="Use on Web"
              subtext="Open in browser"
              bgColor="#C4BEED"
              onClick={() => {
                window.open("https://ifrit-eight.vercel.app", "_blank");
              }}
            />

            <HandDrawnButton
              icon={<PhoneIcon className="w-7 h-8 lg:w-4 lg:h-5" />}
              title={"Download\nMobile App"}
              subtext="iOS & Android"
              bgColor="#C0D8B6"
              onClick={() => alert('Clicked: Download Mobile App')

                
              }
            />

            <HandDrawnButton
              icon={<DesktopIcon className="w-8 h-8 lg:w-5 lg:h-5" />}
              title={"Download\nDesktop App"}
              subtext="Win, macOS, Linux"
              bgColor="#F5E1C3"
              onClick={() => alert('Clicked: Download Desktop App')}
            />
          </div>

        </div>

        {/* RIGHT COLUMN GRAPHIC */}
        <div className="hidden lg:flex flex-1 h-full min-w-0 items-center justify-start overflow-visible pointer-events-none -ml-12 lg:-ml-20 z-0">
          <img 
            src="/landingImage.png" 
            alt="Kimo device file sharing artwork" 
            className="w-[120%] max-w-[850px] xl:max-w-[1000px] h-[600px] object-contain object-left bg-transparent select-none scale-105"
          />
        </div>

      </main>

      {/* FOOTER */}
      <footer className="relative z-20 flex justify-between items-end w-full max-w-7xl mx-auto text-stone-800 font-['Patrick_Hand',cursive] text-lg sm:text-xl font-medium pb-2 px-4 select-none">
        {/* Left Footer */}
      </footer>

      {/* FLOATING ABSOLUTE ANNOTATIONS */}
      <div className="hidden lg:flex absolute top-[53%] left-[41%] xl:left-[45%] flex-col items-center select-none pointer-events-none z-30 -rotate-6">
        <span className="text-stone-800 text-base sm:text-lg font-medium leading-tight text-center">
          Send<br />from here
        </span>
        <svg className="w-12 h-8 text-stone-900 mt-1 ml-4" viewBox="0 0 50 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M 5,5 Q 15,25 40,22" strokeDasharray="3 3" />
          <path d="M 32,17 L 42,22 L 34,27" />
        </svg>
      </div>

      <div className="hidden lg:flex absolute top-[18%] right-[6%] xl:right-[9%] flex-col items-start select-none pointer-events-none z-30 rotate-1">
        <p className="text-stone-800 text-base sm:text-lg font-normal leading-tight text-left">
          Your files<br />
          Your devices<br />
          Your control
        </p>
        <svg 
          className="w-20 h-6 text-stone-900 ml-1 overflow-visible" 
          viewBox="0 0 80 20" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.2" 
          strokeLinecap="round"
        >
          <path d="M 4 8 Q 40 16 76 6" />
        </svg>
      </div>

      <div className="hidden lg:flex absolute top-[67%] right-[3%] xl:right-[8%] flex-col items-start select-none pointer-events-none z-30 -rotate-8">
        <span className="text-stone-800 text-base sm:text-lg font-medium leading-tight text-left">
          Receive<br />anywhere
        </span>
        <svg className="w-12 h-10 text-stone-900 mt-1 -ml-4" viewBox="0 0 50 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M 42,5 Q 30,30 10,28" strokeDasharray="3 3" />
          <path d="M 18,22 L 8,28 L 16,34" />
        </svg>
      </div>

      {/* FOOTER */}
<footer className="relative z-20 w-full max-w-7xl mx-auto text-stone-800 font-['Patrick_Hand',cursive] text-lg sm:text-xl font-medium px-4 select-none lg:mt-0">
  
  {/* Mobile-Only Image Banner */}
  <div className="block lg:hidden w-full pt-4">
    <img 
      src="/catFooter.png" 
      alt="Same speed. More freedom." 
      className="w-full h-auto object-contain mx-auto max-w-md select-none"
    />
  </div>

  {/* Desktop-Only Footer (Preserved) */}
  {/* <div className="hidden lg:flex justify-between items-end w-full">
    <div className="leading-tight flex flex-col items-start -rotate-1">
      <p>Same speed.</p>
      <div className="relative inline-block">
        <p>More freedom.</p>
        <svg className="absolute -bottom-1.5 left-0 w-full h-3 pointer-events-none overflow-visible" viewBox="0 0 100 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M 2 4 Q 50 10 98 3" />
        </svg>
      </div>
    </div> */}
  {/* </div> */}

</footer>

    </div>
  );
}