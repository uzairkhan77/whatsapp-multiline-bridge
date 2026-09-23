'use client'

// framework
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

// Client-only: the shaders need a WebGL context the server doesn't have. The body's
// own gradient is the fallback for no WebGL 2 and for reduced-motion readers.
const GradientWaves = dynamic(() => import('../effects/GradientWaves'), { ssr: false })
const MoltenMetal = dynamic(() => import('../effects/MoltenMetal'), { ssr: false })

/**
 * Which animation runs behind the app. Both are React Bits shaders tuned to the
 * panel's indigo palette; switch here to compare them.
 */
const BACKDROP: 'waves' | 'molten' = 'waves'

/**
 * Animated ground behind every screen, fixed to the viewport so glass panels scroll over it.
 */
// Fewer raymarch steps on phones: shader cost scales with pixels × steps, and
// phones have less battery for it.
export function Backdrop() {
  const [mode, setMode] = useState<'off' | 'phone' | 'full'>('off')

  useEffect(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      setMode(window.matchMedia('(max-width: 640px)').matches ? 'phone' : 'full')
    } catch {
      setMode('full')
    }
  }, [])

  if (mode === 'off') return <div className="app-backdrop" aria-hidden="true" />

  return (
    <div className="app-backdrop" aria-hidden="true">
      {BACKDROP === 'waves' ? (
        <GradientWaves
          horizonColor="#a9c9ef"
          waveColor="#2f86e3"
          crestColor="#eaf4ff"
          speed={0.3}
          amplitude={2.8}
          waveScale={0.6}
          waveRatio={0.9}
          swell={35}
          turbulence={20}
          tilt={1.11}
          zoom={1.0}
          height={5.5}
          fogDepth={28}
          detail={mode === 'phone' ? 'low' : 'medium'}
          brightness={1.1}
          opacity={1}
          mouseInteraction={mode === 'full'}
          parallaxStrength={0.35}
          grain
          grainIntensity={0.04}
        />
      ) : (
        <MoltenMetal
          color1="#dbe8f7"
          color2="#7fb4ee"
          color3="#ffffff"
          speed={0.22}
          scale={mode === 'phone' ? 2.4 : 3.2}
          detail={mode === 'phone' ? 2 : 3}
          glow={1.35}
          coreSize={0.09}
          swirl={0.9}
          fold={-0.2}
          blackPoint={0.07}
          brightness={1.05}
          colorMode="molten"
          grain
          grainIntensity={0.035}
          mouseInteraction={false}
          opacity={0.85}
        />
      )}
    </div>
  )
}
