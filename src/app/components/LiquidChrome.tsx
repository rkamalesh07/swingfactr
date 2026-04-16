'use client'
import { useRef, useEffect } from 'react'

export default function LiquidChrome({
  baseColor = [0.08, 0.08, 0.08],
  speed = 0.4,
  amplitude = 0.5,
  frequencyX = 2.5,
  frequencyY = 1.5,
  interactive = true,
  style = {},
}: {
  baseColor?: number[]
  speed?: number
  amplitude?: number
  frequencyX?: number
  frequencyY?: number
  interactive?: boolean
  style?: React.CSSProperties
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

    let Renderer: any, Program: any, Mesh: any, Triangle: any
    let animationId: number
    let gl: any

    const init = async () => {
      const ogl = await import('ogl' as any)
      Renderer = ogl.Renderer
      Program = ogl.Program
      Mesh = ogl.Mesh
      Triangle = ogl.Triangle

      const renderer = new Renderer({ antialias: true })
      gl = renderer.gl
      gl.clearColor(1, 1, 1, 1)

      const vertex = `
        attribute vec2 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `

      const fragment = `
        precision highp float;
        uniform float uTime;
        uniform vec3 uResolution;
        uniform vec3 uBaseColor;
        uniform float uAmplitude;
        uniform float uFrequencyX;
        uniform float uFrequencyY;
        uniform vec2 uMouse;
        varying vec2 vUv;

        vec4 renderImage(vec2 uvCoord) {
          vec2 fragCoord = uvCoord * uResolution.xy;
          vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);
          for (float i = 1.0; i < 10.0; i++){
            uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
            uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
          }
          vec2 diff = (uvCoord - uMouse);
          float dist = length(diff);
          float falloff = exp(-dist * 20.0);
          float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
          uv += (diff / (dist + 0.0001)) * ripple * falloff;
          vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
          return vec4(color, 1.0);
        }

        void main() {
          vec4 col = vec4(0.0);
          int samples = 0;
          for (int i = -1; i <= 1; i++){
            for (int j = -1; j <= 1; j++){
              vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
              col += renderImage(vUv + offset);
              samples++;
            }
          }
          gl_FragColor = col / float(samples);
        }
      `

      const geometry = new Triangle(gl)
      const program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: new Float32Array([gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height]) },
          uBaseColor: { value: new Float32Array(baseColor) },
          uAmplitude: { value: amplitude },
          uFrequencyX: { value: frequencyX },
          uFrequencyY: { value: frequencyY },
          uMouse: { value: new Float32Array([0.5, 0.5]) },
        },
      })
      const mesh = new Mesh(gl, { geometry, program })

      const resize = () => {
        renderer.setSize(container.offsetWidth, container.offsetHeight)
        const r = program.uniforms.uResolution.value
        r[0] = gl.canvas.width; r[1] = gl.canvas.height; r[2] = gl.canvas.width / gl.canvas.height
      }
      window.addEventListener('resize', resize)
      resize()

      const onMouse = (e: MouseEvent) => {
        const rect = container.getBoundingClientRect()
        program.uniforms.uMouse.value[0] = (e.clientX - rect.left) / rect.width
        program.uniforms.uMouse.value[1] = 1 - (e.clientY - rect.top) / rect.height
      }
      if (interactive) container.addEventListener('mousemove', onMouse)

      const update = (t: number) => {
        animationId = requestAnimationFrame(update)
        program.uniforms.uTime.value = t * 0.001 * speed
        renderer.render({ scene: mesh })
      }
      animationId = requestAnimationFrame(update)
      container.appendChild(gl.canvas)

      return () => {
        cancelAnimationFrame(animationId)
        window.removeEventListener('resize', resize)
        if (interactive) container.removeEventListener('mousemove', onMouse)
        if (gl.canvas.parentElement) gl.canvas.parentElement.removeChild(gl.canvas)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    }

    let cleanup: (() => void) | undefined
    init().then(fn => { cleanup = fn })
    return () => { cleanup?.(); cancelAnimationFrame(animationId) }
  }, [baseColor, speed, amplitude, frequencyX, frequencyY, interactive])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}
