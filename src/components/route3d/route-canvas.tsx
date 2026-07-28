'use client'

/* eslint-disable react-hooks/purity, react-hooks/immutability --
   Imperative three.js scene construction: geometries, canvas textures and
   materials are heap resources built once per stable dependency set inside
   useMemo — the established R3F idiom. The React-Compiler rules cannot see
   that these objects never flow back into React state. */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * The Krebs Route as an actual road.
 *
 * A WebGL scene fixed behind the homepage: a dark carriageway winding through
 * fog, its centre filament glowing signal red, one waypoint per chapter. The
 * camera drives the route as the visitor scrolls — the page IS the journey,
 * which is the storyline the whole site tells in words.
 *
 * Design rules carried over from the 2D system: red exists only as emitted
 * light, surfaces stay near-black but never crushed, and nothing here hijacks
 * scroll — the camera follows the page, never the other way around.
 */

export type RouteDriver = {
  /** Scroll progress of the page, 0..1, written outside React. */
  p: number
  /** Pointer position, -1..1 each axis, for a subtle parallax. */
  mx: number
  my: number
}

const INK = '#060708'
const SIGNAL = '#e10a17'
const CHALK = '#f3f1ec'
/** Where the daylight arc ends — the same warm haze the CSS sky mixes to. */
const DAWN = '#b3aca0'

/** How far along the curve the camera travels over the full scroll. */
const TRAVEL = 0.86

/**
 * The daylight curve, identical to the one the CSS sky uses. Both layers have
 * to describe the same time of day, so the easing lives in one shape and is
 * written twice rather than read back from the DOM every frame.
 */
function daylightAt(p: number) {
  return p < 0.18 ? p * 0.28 : 0.05 + Math.pow((p - 0.18) / 0.82, 0.78) * 0.95
}

/* ── The route itself ─────────────────────────────────────────────── */

function buildCurve() {
  // A gentle S-course: mostly straight ahead with two sweeping bends,
  // so the camera sways naturally without ever leaving the road.
  const pts: THREE.Vector3[] = []
  const LENGTH = 560
  const SEGS = 15
  for (let i = 0; i <= SEGS; i++) {
    const z = -(i / SEGS) * LENGTH
    const x =
      Math.sin((i / SEGS) * Math.PI * 2.1) * 26 +
      Math.sin((i / SEGS) * Math.PI * 0.7) * 14
    pts.push(new THREE.Vector3(x, 0, z))
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
}

/** Ribbon geometry along the curve: road bed, or a narrow stripe of it. */
function ribbonGeometry(curve: THREE.CatmullRomCurve3, halfWidth: number, offset = 0, samples = 420) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    curve.getPointAt(t, point)
    curve.getTangentAt(t, tangent)
    normal.crossVectors(tangent, UP).normalize()
    const cx = point.x + normal.x * offset
    const cz = point.z + normal.z * offset
    positions.push(cx - normal.x * halfWidth, 0, cz - normal.z * halfWidth)
    positions.push(cx + normal.x * halfWidth, 0, cz + normal.z * halfWidth)
    uvs.push(0, t, 1, t)
    if (i < samples) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

/* ── Materials ────────────────────────────────────────────────────── */

/** The glowing centre filament: a slow pulse of light travels the route. */
function filamentMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: 0 },
      uColor: { value: new THREE.Color(SIGNAL) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uCam;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        // Soft core across the stripe width
        float core = smoothstep(0.5, 0.06, abs(vUv.x - 0.5));
        // Base glow, brighter near the camera's position on the route
        float near = smoothstep(0.22, 0.0, abs(vUv.y - uCam)) * 0.72;
        // A pulse of light travelling ahead of the camera
        float pt = fract(uTime * 0.045);
        float pulse = smoothstep(0.09, 0.0, abs(vUv.y - pt)) * 0.8;
        float a = core * (0.32 + near * 0.55 + pulse);
        gl_FragColor = vec4(uColor * (1.0 + pulse * 0.6), a);
      }
    `,
  })
}

/** Waypoint light pillar: additive, fading with height. */
const pillarMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(SIGNAL) }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBoost;
      varying vec2 vUv;
      void main() {
        float h = pow(1.0 - vUv.y, 2.2);
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        gl_FragColor = vec4(uColor, h * edge * (0.35 + uBoost * 0.65));
      }
    `,
  })

/** Soft round glow texture, drawn once — for dust points and town glows. */
function glowTexture(inner: string, size = 64) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Chapter marker label, drawn to a canvas texture: "01" … "11". */
function labelTexture(text: string) {
  const w = 128
  const h = 64
  const canvas = document.createElement('canvas')
  canvas.width = w * 2
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  ctx.font = "700 30px Archivo, 'Archivo Fallback', system-ui, sans-serif"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = CHALK
  ctx.globalAlpha = 0.92
  ctx.fillText(text, w / 2, h / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* ── Scene ────────────────────────────────────────────────────────── */

function Waypoints({ curve, fractions }: { curve: THREE.CatmullRomCurve3; fractions: number[] }) {
  const group = useMemo(() => {
    const g: {
      pos: THREE.Vector3
      side: number
      label: THREE.Texture
      t: number
    }[] = []
    const tangent = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const UP = new THREE.Vector3(0, 1, 0)
    fractions.forEach((f, i) => {
      const t = Math.min(0.995, f * TRAVEL + 0.012)
      const pos = curve.getPointAt(t)
      curve.getTangentAt(t, tangent)
      normal.crossVectors(tangent, UP).normalize()
      const side = i % 2 === 0 ? 1 : -1
      pos.addScaledVector(normal, side * 7.2)
      g.push({ pos, side, label: labelTexture(String(i + 1).padStart(2, '0')), t })
    })
    return g
  }, [curve, fractions])

  const pillarGeo = useMemo(() => new THREE.PlaneGeometry(1.7, 9, 1, 1), [])
  const ringGeo = useMemo(() => new THREE.TorusGeometry(1.15, 0.045, 8, 48), [])
  const materials = useMemo(() => group.map(() => pillarMaterial()), [group])
  const ringMats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const labelMats = useRef<(THREE.SpriteMaterial | null)[]>([])

  useFrame((state) => {
    const p = (state.scene.userData.driver as RefObject<RouteDriver> | undefined)?.current?.p ?? 0
    const camT = p * TRAVEL
    materials.forEach((m, i) => {
      const t = group[i]!.t
      // A marker announces itself ahead and dissolves as the camera passes —
      // driving past a sign, not watching one blink out.
      const passed = THREE.MathUtils.clamp((t - camT - 0.004) * 90, 0, 1)
      const d = Math.abs(t - camT)
      m.uniforms.uBoost!.value = THREE.MathUtils.clamp(1 - d * 14, 0, 1) * passed
      const ring = ringMats.current[i]
      if (ring) ring.opacity = 0.5 * passed
      const label = labelMats.current[i]
      // Labels are signage: readable in the mid-distance, never looming
      // overhead when the camera is right next to the post.
      if (label) label.opacity = 0.6 * passed * THREE.MathUtils.clamp((t - camT - 0.02) * 28, 0, 1)
    })
  })

  return (
    <>
      {group.map((wp, i) => (
        <group key={i} position={[wp.pos.x, 0, wp.pos.z]}>
          <mesh geometry={pillarGeo} material={materials[i]} position={[0, 4.5, 0]} rotation={[0, wp.side > 0 ? -0.5 : 0.5, 0]} />
          <mesh geometry={ringGeo} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <meshBasicMaterial
              ref={(m) => {
                ringMats.current[i] = m
              }}
              color={SIGNAL}
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <sprite position={[0, 8.6, 0]} scale={[3, 1.5, 1]}>
            <spriteMaterial
              ref={(m) => {
                labelMats.current[i] = m
              }}
              map={wp.label}
              transparent
              opacity={0.6}
              depthWrite={false}
            />
          </sprite>
        </group>
      ))}
    </>
  )
}

function DestinationGlow({ curve, tex }: { curve: THREE.CatmullRomCurve3; tex: THREE.Texture }) {
  const mat = useRef<THREE.SpriteMaterial>(null)
  const end = useMemo(() => curve.getPointAt(0.999), [curve])
  useFrame((state) => {
    const p = (state.scene.userData.driver as RefObject<RouteDriver> | undefined)?.current?.p ?? 0
    if (mat.current) mat.current.opacity = 0.35 + Math.pow(p, 2.5) * 0.55
  })
  return (
    <sprite position={[end.x, 3.5, end.z - 30]} scale={[70, 26, 1]}>
      <spriteMaterial ref={mat} map={tex} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  )
}

function Dust() {
  const ref = useRef<THREE.Points>(null)
  const { positions, tex } = useMemo(() => {
    const n = 340
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 130
      arr[i * 3 + 1] = Math.random() * 16 + 0.5
      arr[i * 3 + 2] = -Math.random() * 560
    }
    return { positions: arr, tex: glowTexture('rgba(243,241,236,0.9)') }
  }, [])
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.position.y = Math.sin(t * 0.11) * 0.7
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial map={tex} color={CHALK} size={0.5} sizeAttenuation transparent opacity={0.38} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function Scene({ driver, fractions }: { driver: RefObject<RouteDriver>; fractions: number[] }) {
  const curve = useMemo(() => buildCurve(), [])
  const roadGeo = useMemo(() => ribbonGeometry(curve, 5.4), [curve])
  const filamentGeo = useMemo(() => ribbonGeometry(curve, 0.32), [curve])
  const edgeLeftGeo = useMemo(() => ribbonGeometry(curve, 0.07, -5.1), [curve])
  const edgeRightGeo = useMemo(() => ribbonGeometry(curve, 0.07, 5.1), [curve])
  const filament = useMemo(() => filamentMaterial(), [])
  const townTex = useMemo(() => glowTexture('rgba(255,214,170,0.85)', 128), [])
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.userData.driver = driver
  }, [scene, driver])

  const smooth = useRef({ t: 0, mx: 0, my: 0 })
  const fogRef = useRef<THREE.FogExp2>(null)
  const groundRef = useRef<THREE.MeshBasicMaterial>(null)
  const roadRef = useRef<THREE.MeshBasicMaterial>(null)

  // Scratch colours, reused every frame so the loop allocates nothing.
  const palette = useMemo(
    () => ({
      ink: new THREE.Color(INK),
      dawn: new THREE.Color(DAWN),
      ground: new THREE.Color('#08090b'),
      groundDay: new THREE.Color('#8f897d'),
      road: new THREE.Color('#101114'),
      roadDay: new THREE.Color('#6d675d'),
      work: new THREE.Color(),
    }),
    [],
  )

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3.2)
    const s = smooth.current
    const d = driver.current
    s.t += (d.p * TRAVEL - s.t) * k
    s.mx += (d.mx - s.mx) * (1 - Math.exp(-dt * 2.2))
    s.my += (d.my - s.my) * (1 - Math.exp(-dt * 2.2))

    const t = THREE.MathUtils.clamp(s.t, 0, 0.995)
    const pos = curve.getPointAt(t)
    const ahead = curve.getPointAt(Math.min(0.999, t + 0.018))
    const cam = state.camera
    cam.position.set(pos.x + s.mx * 1.4, 2.35 + s.my * -0.5, pos.z + 6.5)
    cam.lookAt(ahead.x + s.mx * 2.2, 1.55 + s.my * -1.1, ahead.z)

    filament.uniforms.uTime!.value = state.clock.elapsedTime
    filament.uniforms.uCam!.value = t

    // Dawn breaks over the route in step with the CSS sky behind it.
    const day = daylightAt(d.p)
    if (fogRef.current) {
      fogRef.current.color.copy(palette.ink).lerp(palette.dawn, day)
      // Daylight also clears the air: you can see further down the road.
      fogRef.current.density = 0.0105 - day * 0.0042
    }
    if (groundRef.current) groundRef.current.color.copy(palette.ground).lerp(palette.groundDay, day)
    if (roadRef.current) roadRef.current.color.copy(palette.road).lerp(palette.roadDay, day)
  })

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={[INK, 0.0105]} />
      {/* Ground: keeps the road from floating in a void */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, -260]}>
        <planeGeometry args={[900, 900]} />
        <meshBasicMaterial ref={groundRef} color="#08090b" />
      </mesh>
      {/* Road bed, slightly lighter than the void */}
      <mesh geometry={roadGeo} position={[0, 0.01, 0]}>
        <meshBasicMaterial ref={roadRef} color="#101114" />
      </mesh>
      {/* Edge lines, chalk at low opacity */}
      <mesh geometry={edgeLeftGeo} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={CHALK} transparent opacity={0.13} depthWrite={false} />
      </mesh>
      <mesh geometry={edgeRightGeo} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={CHALK} transparent opacity={0.13} depthWrite={false} />
      </mesh>
      {/* The signal-red filament */}
      <mesh geometry={filamentGeo} material={filament} position={[0, 0.03, 0]} />
      <Waypoints curve={curve} fractions={fractions} />
      <Dust />
      {/* Destination glow far ahead — the town you are driving toward.
          It brightens as the journey nears its end. */}
      <DestinationGlow curve={curve} tex={townTex} />
    </>
  )
}

export default function RouteCanvas({ driver, fractions }: { driver: RefObject<RouteDriver>; fractions: number[] }) {
  // A scene nobody is looking at must not cost a frame. The loop stops when
  // the tab goes to the background and when the visitor is deep inside a
  // daylight chapter, which is opaque and covers the route completely.
  const [running, setRunning] = useState(true)

  useEffect(() => {
    const decide = () => {
      if (document.hidden) return setRunning(false)
      const covered = [...document.querySelectorAll<HTMLElement>('.chapter-day')].some((el) => {
        const r = el.getBoundingClientRect()
        return r.top <= 0 && r.bottom >= window.innerHeight
      })
      setRunning(!covered)
    }

    let frame = 0
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        decide()
      })
    }

    decide()
    document.addEventListener('visibilitychange', decide)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      document.removeEventListener('visibilitychange', decide)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={running ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 58, near: 0.1, far: 320 }}
      style={{ pointerEvents: 'none' }}
      aria-hidden
    >
      <Scene driver={driver} fractions={fractions} />
    </Canvas>
  )
}
