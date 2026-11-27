import React, { useLayoutEffect, useRef } from 'react';
import { useVideoConfig } from 'remotion';
import { FS } from './shader';

export type OrbProps = { cx: number; cy: number; R: number; swirl: number; glow: number; fill?: number; ring?: number; ringA?: number; fade?: number };

// The real orb, drawn by the same shader as the app, one frame at a time so every render is identical.
export const Orb: React.FC<OrbProps> = (p) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef<{ gl: WebGLRenderingContext; U: Record<string, WebGLUniformLocation | null> } | null>(null);
  const { width, height } = useVideoConfig();

  useLayoutEffect(() => {
    const cv = ref.current!;
    if (!st.current) {
      const gl = cv.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true })!;
      const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) || 'shader'); return x; };
      const pr = gl.createProgram()!;
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr); gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      const U: Record<string, WebGLUniformLocation | null> = {};
      ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill', 'uRing', 'uRingA', 'uFade'].forEach((k) => (U[k] = gl.getUniformLocation(pr, k)));
      st.current = { gl, U };
    }
    const { gl, U } = st.current;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(U.uRes, width, height); gl.uniform1f(U.uT, p.swirl);
    gl.uniform2f(U.uC, p.cx, height - p.cy); gl.uniform1f(U.uR, Math.max(p.R, 0.5));
    gl.uniform1f(U.uGlow, Math.max(p.glow, 0)); gl.uniform1f(U.uFill, p.fill ?? 1);
    gl.uniform1f(U.uRing, p.ring ?? 0); gl.uniform1f(U.uRingA, p.ringA ?? 0); gl.uniform1f(U.uFade, p.fade ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', inset: 0, width, height }} />;
};
