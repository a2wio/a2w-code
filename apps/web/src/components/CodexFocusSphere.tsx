"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Icon } from "./Icon";

export type CodexFocusStatus = "idle" | "thinking" | "tool_running" | "files_changed" | "blocked" | "error" | "cancelled" | "complete";

export type CodexFocusAction = {
  kind: "search" | "command" | "file" | "thinking" | "generic";
  label: string;
  detail?: string;
};

type CodexFocusSphereProps = {
  status: CodexFocusStatus;
  statusLabel: string;
  detail?: string;
  rootName: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  actions: CodexFocusAction[];
  responseSummary?: string;
  presentation?: "focus" | "new-chat";
  onShowTranscript?: () => void;
};

const PARTICLE_COUNT = 720;
const CURVE_COUNT = 54;
const CURVE_SEGMENTS = 108;
const MAGNET_COUNT = 4;
const SPHERE_RADIUS = 2.08;

export function CodexFocusSphere({
  status,
  statusLabel,
  detail,
  rootName,
  changedFiles,
  additions,
  deletions,
  actions,
  responseSummary,
  presentation = "focus",
  onShowTranscript
}: CodexFocusSphereProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  const changedFilesRef = useRef(changedFiles);
  const minimal = presentation === "new-chat";

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    changedFilesRef.current = changedFiles;
  }, [changedFiles]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("data-codex-focus-sphere-canvas", "true");
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.z = 6.9;

    const group = new THREE.Group();
    group.position.y = 0.08;
    scene.add(group);

    const seeds = createParticleSeeds(PARTICLE_COUNT);
    const curveSeeds = createCurveSeeds(CURVE_COUNT);
    const magnetSeeds = createMagnetSeeds(MAGNET_COUNT);
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x5c4ee5,
      size: 0.018,
      transparent: true,
      opacity: 0.38,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    group.add(points);

    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(2.01, 80, 40),
      new THREE.MeshBasicMaterial({
        color: 0x5c4ee5,
        transparent: true,
        opacity: 0.035,
        depthWrite: false
      })
    );
    group.add(surface);

    const curveGroup = new THREE.Group();
    group.add(curveGroup);

    const curveMaterial = new THREE.LineBasicMaterial({
      color: 0x5c4ee5,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const curveGeometries = curveSeeds.map((seed) => {
      const curvePositions = new Float32Array((CURVE_SEGMENTS + 1) * 3);
      const curveGeometry = new THREE.BufferGeometry();
      curveGeometry.setAttribute("position", new THREE.BufferAttribute(curvePositions, 3));
      updateOrganicCurve(curvePositions, seed, [], 0, statusProfile(statusRef.current), 1);
      const line = new THREE.Line(curveGeometry, curveMaterial);
      curveGroup.add(line);
      return curveGeometry;
    });

    const magnetGeometry = new THREE.SphereGeometry(0.04, 16, 8);
    const magnetMeshes = magnetSeeds.map((seed) => {
      const mesh = new THREE.Mesh(
        magnetGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x5c4ee5,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      const scale = 1 + seed.strength * 1.6;
      mesh.scale.setScalar(scale);
      group.add(mesh);
      return mesh;
    });

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 40, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false
      })
    );
    group.add(core);

    let frame = 0;
    let width = 1;
    let height = 1;

    function resize() {
      if (!mount) return;
      width = Math.max(1, mount.clientWidth);
      height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const scale = Math.min(width, height) < 560 ? 0.78 : 0.9;
      group.scale.setScalar(scale);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const animatedProfile = { ...statusProfile(statusRef.current) };
    const animatedColor = new THREE.Color(animatedProfile.color);
    const targetColor = new THREE.Color(animatedProfile.color);

    function animate(now: number) {
      const seconds = now / 1000;
      const motion = reduceMotion ? 0.18 : 1;
      const profile = statusProfile(statusRef.current);
      const transition = reduceMotion ? 1 : 0.075;
      targetColor.set(profile.color);
      animatedColor.lerp(targetColor, transition);
      lerpProfile(animatedProfile, profile, transition);
      const changedPulse = Math.min(1, changedFilesRef.current / 12);
      const breath = Math.sin(seconds * animatedProfile.breathSpeed * motion) * animatedProfile.breath;
      const pulse = Math.max(0, Math.sin(seconds * 4.6 * motion)) * animatedProfile.pulse;
      const magnets = magnetSeeds.map((seed, index) => {
        const magnet = magnetPosition(seed, seconds, motion, index);
        magnetMeshes[index].position.set(
          magnet.x * (SPHERE_RADIUS + 0.075),
          magnet.y * (SPHERE_RADIUS + 0.075),
          magnet.z * (SPHERE_RADIUS + 0.075)
        );
        return magnet;
      });

      material.color.copy(animatedColor);
      material.opacity = animatedProfile.particleOpacity;
      material.size = animatedProfile.particleSize + pulse * 0.007;
      curveMaterial.color.copy(animatedColor);
      curveMaterial.opacity = animatedProfile.curveOpacity + pulse * 0.12;
      surface.material.color.copy(animatedColor);
      surface.material.opacity = animatedProfile.surfaceOpacity + changedPulse * 0.012;
      core.material.opacity = animatedProfile.coreOpacity + pulse * 0.07;

      for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const seed = seeds[index];
        const offset = index * 3;
        const wave = Math.sin(seconds * animatedProfile.waveSpeed * motion + seed.phase + seed.y * 5.2) * animatedProfile.wave;
        const orbit = Math.cos(seconds * animatedProfile.orbitSpeed * motion + seed.phase * 1.7) * animatedProfile.orbit;
        const drift = changedPulse * Math.sin(seconds * 5.4 * motion + seed.phase) * 0.055;
        const radius = SPHERE_RADIUS + breath + wave + drift;
        const twist = orbit + seconds * animatedProfile.twistSpeed * motion;
        const cos = Math.cos(twist);
        const sin = Math.sin(twist);
        const x = seed.x * cos - seed.z * sin;
        const z = seed.x * sin + seed.z * cos;

        positions[offset] = x * radius;
        positions[offset + 1] = seed.y * radius + Math.sin(seconds * 1.4 * motion + seed.phase) * profile.innerMotion;
        positions[offset + 2] = z * radius;
      }

      geometry.attributes.position.needsUpdate = true;
      curveGeometries.forEach((curveGeometry, index) => {
        updateOrganicCurve(
          curveGeometry.attributes.position.array as Float32Array,
          curveSeeds[index],
          magnets,
          seconds,
          animatedProfile,
          motion
        );
        curveGeometry.attributes.position.needsUpdate = true;
      });
      group.rotation.y = seconds * animatedProfile.rotation * motion;
      group.rotation.x = Math.sin(seconds * 0.28 * motion) * 0.13;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    }

    frame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      surface.geometry.dispose();
      surface.material.dispose();
      curveGeometries.forEach((curveGeometry) => curveGeometry.dispose());
      curveMaterial.dispose();
      magnetGeometry.dispose();
      magnetMeshes.forEach((mesh) => mesh.material.dispose());
      core.geometry.dispose();
      core.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#fbfbf9]">
      <FocusGlow status={status} />
      <div
        ref={mountRef}
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 ${minimal ? "top-[42%]" : "top-[43%]"}`}
        style={{
          width: minimal ? "min(72vw, 52vh, 650px)" : "min(76vw, 56vh, 720px)",
          height: minimal ? "min(72vw, 52vh, 650px)" : "min(76vw, 56vh, 720px)"
        }}
      />

      <ActionNotificationReel actions={actions} />

      <div className={`absolute inset-x-4 z-10 mx-auto grid max-w-3xl gap-2 sm:inset-x-8 ${minimal ? "top-[63%]" : "bottom-4 sm:bottom-5"}`}>
        <div className="mx-auto mb-1 flex max-w-xl flex-col items-center text-center">
          {minimal ? null : <div className={`mb-3 h-2 w-2 rounded-full shadow-[0_0_22px_currentColor] transition-colors duration-700 ease-out ${statusDotClass(status)}`} />}
          <h2 className={`${minimal ? "text-2xl font-normal italic sm:text-3xl" : "text-xl font-semibold sm:text-2xl"} tracking-[-0.035em] text-gray-950`}>{statusLabel}</h2>
          {detail ? <p className="mt-2 max-w-md text-xs leading-6 text-gray-500 sm:text-sm">{detail}</p> : null}
          {responseSummary ? (
            <p className="mt-3 max-w-xl text-balance text-sm font-medium leading-7 text-gray-800 sm:text-[15px]">
              “{responseSummary}”
            </p>
          ) : null}
        </div>
        {minimal ? null : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <FocusMetric icon="fa-code-branch" label={`${changedFiles} changed`} />
            <FocusMetric icon="fa-plus" label={`+${additions}`} tone="add" />
            <FocusMetric icon="fa-minus" label={`-${deletions}`} tone="remove" />
          </div>
        )}
      </div>

      {onShowTranscript ? (
        <button
          type="button"
          onClick={onShowTranscript}
          className="absolute left-1/2 top-2 z-30 inline-flex h-9 shrink-0 -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 text-xs font-semibold text-gray-700 shadow-sm shadow-black/[0.03] backdrop-blur transition hover:border-gray-300 hover:bg-white hover:text-black sm:top-4"
          aria-label="Inspect mode"
        >
          <Icon name="fa-message" />
          Inspect mode
        </button>
      ) : null}
    </section>
  );
}

function FocusGlow({ status }: { status: CodexFocusStatus }) {
  const layers: Array<{ key: CodexFocusStatus | "default"; className: string; active: boolean }> = [
    {
      key: "default",
      active: status === "idle",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(92,78,229,0.16),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.05),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "thinking",
      active: status === "thinking" || status === "tool_running",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.18),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(37,99,235,0.1),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "files_changed",
      active: status === "files_changed",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(240,80,50,0.18),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(240,80,50,0.08),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "blocked",
      active: status === "blocked",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(217,119,6,0.14),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "error",
      active: status === "error",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(220,38,38,0.13),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "cancelled",
      active: status === "cancelled",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(239,68,68,0.22),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(185,28,28,0.12),rgba(251,251,249,0)_44%)]"
    },
    {
      key: "complete",
      active: status === "complete",
      className: "bg-[radial-gradient(circle_at_50%_42%,rgba(5,150,105,0.13),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]"
    }
  ];

  return (
    <div className="absolute inset-0" aria-hidden="true">
      {layers.map((layer) => (
        <div
          key={layer.key}
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${layer.className} ${layer.active ? "opacity-100" : "opacity-0"}`}
        />
      ))}
    </div>
  );
}

function FocusMetric({ icon, label, tone }: { icon: string; label: string; tone?: "add" | "remove" }) {
  const toneClass = tone === "add" ? "text-emerald-600" : tone === "remove" ? "text-red-600" : "text-gray-600";
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-3 text-[11px] font-semibold shadow-sm shadow-black/[0.02] backdrop-blur">
      <Icon name={icon} className="text-gray-400" />
      <span className={toneClass}>{label}</span>
    </span>
  );
}

function ActionNotificationReel({ actions }: { actions: CodexFocusAction[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const visibleActions = actions.slice(-18);
  const latestActionSignature = visibleActions
    .map((action) => `${action.kind}:${action.label}:${action.detail || ""}`)
    .join("|");

  function updateFocusedNotification() {
    const scroller = scrollRef.current;
    if (!scroller || !visibleActions.length) return;

    if (scroller.scrollTop < 6) {
      setFocusedIndex(0);
      return;
    }

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 6) {
      setFocusedIndex(visibleActions.length - 1);
      return;
    }

    const viewportCenter = scroller.scrollTop + scroller.clientHeight * 0.5;
    let nextFocusedIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const itemCenter = item.offsetTop + item.offsetHeight / 2;
      const distance = Math.abs(itemCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        nextFocusedIndex = index;
      }
    });

    setFocusedIndex(nextFocusedIndex);
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      updateFocusedNotification();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestActionSignature]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, visibleActions.length);
    setFocusedIndex(Math.max(0, visibleActions.length - 1));
  }, [visibleActions.length]);

  if (!visibleActions.length) return null;

  return (
    <div className="absolute right-4 top-6 z-20 w-[min(22.5rem,calc(100%-0.5rem))]">
      {/* <NotificationFadeEdge edge="top" />
      <NotificationFadeEdge edge="bottom" /> */}
      <div
        ref={scrollRef}
        onScroll={updateFocusedNotification}
        className="no-scrollbar relative z-10 max-h-[8.6rem] overflow-y-auto overflow-x-hidden transition-all duration-200"
        aria-live="polite"
      >
        <div className="flex min-h-full flex-col p-2">
          {visibleActions.map((action, index) => (
            <div
              key={`${action.kind}-${action.label}-${action.detail || ""}-${index}`}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              className={`motion-enter relative flex min-h-10 origin-center items-center gap-2 rounded-2xl border px-3 py-2 text-xs backdrop-blur-2xl ring-1 transition duration-300 ease-out ${index > 0 ? "-mt-2" : ""} ${
                index === focusedIndex
                  ? "scale-[1.065] border-white/70 bg-white/[0.24] text-gray-600 ring-white/35"
                  : "scale-[0.975] border-white/35 bg-white/[0.12] text-gray-400 ring-white/15"
              }`}
              style={{ zIndex: index === focusedIndex ? 80 : Math.max(1, 40 - Math.abs(index - focusedIndex)) }}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/40 text-[10px] transition-colors ${index === focusedIndex ? "text-gray-500" : "text-gray-300"}`}>
                <Icon name={focusActionIcon(action.kind)} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className={`font-semibold transition-colors ${index === focusedIndex ? "text-gray-700" : "text-gray-500"}`}>{action.label}</span>
                {action.detail ? <span className={`ml-1 font-mono text-[11px] transition-colors ${index === focusedIndex ? "text-gray-400" : "text-gray-300"}`}>{action.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotificationFadeEdge({ edge }: { edge: "top" | "bottom" }) {
  const isTop = edge === "top";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute right-0 z-30 h-8 w-[97%] rounded-2xl bg-white/[0.06] backdrop-blur-3xl ${
        isTop ? "top-0" : "bottom-0"
      }`}
      style={{
        WebkitMaskImage: isTop
          ? "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.7) 38%, transparent 100%)"
          : "linear-gradient(to top, black 0%, rgba(0,0,0,0.7) 38%, transparent 100%)",
        maskImage: isTop
          ? "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.7) 38%, transparent 100%)"
          : "linear-gradient(to top, black 0%, rgba(0,0,0,0.7) 38%, transparent 100%)"
      }}
    />
  );
}

function createParticleSeeds(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - ((index + 0.5) / count) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    return {
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      phase: seededNoise(index) * Math.PI * 2
    };
  });
}

type CurveSeed = {
  theta: number;
  phase: number;
  frequency: number;
  speed: number;
  tightness: number;
};

type MagnetSeed = {
  theta: number;
  phi: number;
  phase: number;
  speed: number;
  wobble: number;
  strength: number;
};

type MagnetPosition = {
  x: number;
  y: number;
  z: number;
  strength: number;
};

function createCurveSeeds(count: number): CurveSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    theta: (index / count) * Math.PI * 2 + seededNoise(index + 90) * 0.05,
    phase: seededNoise(index + 180) * Math.PI * 2,
    frequency: 2.4 + seededNoise(index + 270) * 4.6,
    speed: 0.42 + seededNoise(index + 360) * 0.36,
    tightness: 7.5 + seededNoise(index + 450) * 5.5
  }));
}

function createMagnetSeeds(count: number): MagnetSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    theta: (index / count) * Math.PI * 2 + seededNoise(index + 540) * 0.8,
    phi: Math.PI * (0.23 + seededNoise(index + 630) * 0.54),
    phase: seededNoise(index + 720) * Math.PI * 2,
    speed: 0.12 + seededNoise(index + 810) * 0.12,
    wobble: 0.24 + seededNoise(index + 900) * 0.18,
    strength: 0.26 + seededNoise(index + 990) * 0.24
  }));
}

function magnetPosition(seed: MagnetSeed, seconds: number, motion: number, index: number): MagnetPosition {
  const theta = seed.theta + seconds * seed.speed * motion + Math.sin(seconds * 0.23 * motion + seed.phase) * 0.34;
  const phi = clamp(seed.phi + Math.sin(seconds * seed.wobble * motion + seed.phase + index) * 0.34, 0.18, Math.PI - 0.18);
  const y = Math.cos(phi);
  const radius = Math.sin(phi);
  return {
    x: Math.cos(theta) * radius,
    y,
    z: Math.sin(theta) * radius,
    strength: seed.strength
  };
}

function updateOrganicCurve(
  positions: Float32Array,
  seed: CurveSeed,
  magnets: MagnetPosition[],
  seconds: number,
  profile: ReturnType<typeof statusProfile>,
  motion: number
) {
  for (let segment = 0; segment <= CURVE_SEGMENTS; segment += 1) {
    const v = segment / CURVE_SEGMENTS;
    const phi = v * Math.PI;
    const lat = Math.sin(phi);
    const organicWave = Math.sin(seconds * seed.speed * motion + v * Math.PI * seed.frequency + seed.phase) * profile.curveWave * lat;
    const fuzz = Math.sin(seconds * 18 * motion + seed.phase * 1.7 + segment * 0.71) *
      Math.sin(seconds * 11 * motion + seed.phase + segment * 0.19) *
      profile.curveFuzz *
      lat;
    const theta = seed.theta + organicWave + fuzz + Math.sin(seconds * 0.18 * motion + seed.phase) * 0.035;
    let x = Math.cos(theta) * lat;
    let y = Math.cos(phi);
    let z = Math.sin(theta) * lat;

    for (const magnet of magnets) {
      const dot = Math.max(0, x * magnet.x + y * magnet.y + z * magnet.z);
      const pull = Math.pow(dot, seed.tightness) * magnet.strength * profile.magnetPull * lat;
      if (pull <= 0.0001) continue;
      x += (magnet.x - x) * pull;
      y += (magnet.y - y) * pull;
      z += (magnet.z - z) * pull;
      const length = Math.hypot(x, y, z) || 1;
      x /= length;
      y /= length;
      z /= length;
    }

    const ripple = (
      Math.sin(seconds * profile.waveSpeed * motion + seed.phase + v * Math.PI * seed.frequency) * profile.surfaceRipple +
      fuzz * 0.18
    ) * lat;
    const radius = SPHERE_RADIUS + ripple;
    const offset = segment * 3;
    positions[offset] = x * radius;
    positions[offset + 1] = y * radius;
    positions[offset + 2] = z * radius;
  }
}

function seededNoise(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const profileNumberKeys = [
  "particleOpacity",
  "particleSize",
  "curveOpacity",
  "surfaceOpacity",
  "magnetOpacity",
  "breath",
  "breathSpeed",
  "pulse",
  "wave",
  "waveSpeed",
  "orbit",
  "orbitSpeed",
  "twistSpeed",
  "rotation",
  "innerMotion",
  "curveWave",
  "curveFuzz",
  "magnetPull",
  "surfaceRipple",
  "coreOpacity"
] as const;

function lerpProfile(current: ReturnType<typeof statusProfile>, target: ReturnType<typeof statusProfile>, amount: number) {
  for (const key of profileNumberKeys) {
    current[key] += (target[key] - current[key]) * amount;
  }
}

function statusProfile(status: CodexFocusStatus) {
  if (status === "thinking") {
    return {
      color: "#2563EB",
      particleOpacity: 0.46,
      particleSize: 0.019,
      curveOpacity: 0.72,
      surfaceOpacity: 0.045,
      magnetOpacity: 0.42,
      breath: 0.06,
      breathSpeed: 1.55,
      pulse: 0.32,
      wave: 0.105,
      waveSpeed: 3.2,
      orbit: 0.055,
      orbitSpeed: 1.35,
      twistSpeed: 0.13,
      rotation: 0.09,
      innerMotion: 0.035,
      curveWave: 0.16,
      curveFuzz: 0.04,
      magnetPull: 0.13,
      surfaceRipple: 0.045,
      coreOpacity: 0.09
    };
  }
  if (status === "tool_running") {
    return {
      color: "#0EA5E9",
      particleOpacity: 0.44,
      particleSize: 0.02,
      curveOpacity: 0.78,
      surfaceOpacity: 0.045,
      magnetOpacity: 0.45,
      breath: 0.04,
      breathSpeed: 2.2,
      pulse: 0.42,
      wave: 0.15,
      waveSpeed: 4.2,
      orbit: 0.09,
      orbitSpeed: 2.1,
      twistSpeed: 0.18,
      rotation: 0.13,
      innerMotion: 0.045,
      curveWave: 0.2,
      curveFuzz: 0.065,
      magnetPull: 0.16,
      surfaceRipple: 0.055,
      coreOpacity: 0.11
    };
  }
  if (status === "files_changed") {
    return {
      color: "#F05032",
      particleOpacity: 0.38,
      particleSize: 0.019,
      curveOpacity: 0.66,
      surfaceOpacity: 0.038,
      magnetOpacity: 0.44,
      breath: 0.05,
      breathSpeed: 1.7,
      pulse: 0.3,
      wave: 0.11,
      waveSpeed: 2.8,
      orbit: 0.075,
      orbitSpeed: 1.65,
      twistSpeed: 0.15,
      rotation: 0.11,
      innerMotion: 0.035,
      curveWave: 0.15,
      curveFuzz: 0.006,
      magnetPull: 0.15,
      surfaceRipple: 0.038,
      coreOpacity: 0.1
    };
  }
  if (status === "blocked") {
    return {
      color: "#d97706",
      particleOpacity: 0.32,
      particleSize: 0.018,
      curveOpacity: 0.52,
      surfaceOpacity: 0.032,
      magnetOpacity: 0.36,
      breath: 0.035,
      breathSpeed: 0.9,
      pulse: 0.2,
      wave: 0.045,
      waveSpeed: 1.3,
      orbit: 0.025,
      orbitSpeed: 0.85,
      twistSpeed: 0.06,
      rotation: 0.045,
      innerMotion: 0.018,
      curveWave: 0.07,
      curveFuzz: 0.004,
      magnetPull: 0.09,
      surfaceRipple: 0.022,
      coreOpacity: 0.085
    };
  }
  if (status === "error") {
    return {
      color: "#dc2626",
      particleOpacity: 0.34,
      particleSize: 0.018,
      curveOpacity: 0.58,
      surfaceOpacity: 0.034,
      magnetOpacity: 0.4,
      breath: 0.025,
      breathSpeed: 1.1,
      pulse: 0.28,
      wave: 0.055,
      waveSpeed: 1.6,
      orbit: 0.035,
      orbitSpeed: 0.9,
      twistSpeed: 0.05,
      rotation: 0.035,
      innerMotion: 0.018,
      curveWave: 0.08,
      curveFuzz: 0.008,
      magnetPull: 0.1,
      surfaceRipple: 0.024,
      coreOpacity: 0.1
    };
  }
  if (status === "cancelled") {
    return {
      color: "#EF4444",
      particleOpacity: 0.46,
      particleSize: 0.019,
      curveOpacity: 0.78,
      surfaceOpacity: 0.05,
      magnetOpacity: 0.48,
      breath: 0.04,
      breathSpeed: 2.4,
      pulse: 0.44,
      wave: 0.13,
      waveSpeed: 4.4,
      orbit: 0.08,
      orbitSpeed: 2,
      twistSpeed: 0.16,
      rotation: 0.12,
      innerMotion: 0.04,
      curveWave: 0.18,
      curveFuzz: 0.04,
      magnetPull: 0.14,
      surfaceRipple: 0.05,
      coreOpacity: 0.12
    };
  }
  if (status === "complete") {
    return {
      color: "#059669",
      particleOpacity: 0.3,
      particleSize: 0.017,
      curveOpacity: 0.5,
      surfaceOpacity: 0.03,
      magnetOpacity: 0.34,
      breath: 0.026,
      breathSpeed: 0.72,
      pulse: 0.12,
      wave: 0.035,
      waveSpeed: 0.85,
      orbit: 0.02,
      orbitSpeed: 0.6,
      twistSpeed: 0.04,
      rotation: 0.035,
      innerMotion: 0.012,
      curveWave: 0.055,
      curveFuzz: 0.003,
      magnetPull: 0.08,
      surfaceRipple: 0.018,
      coreOpacity: 0.07
    };
  }
  return {
    color: "#5c4ee5",
    particleOpacity: 0.28,
    particleSize: 0.017,
    curveOpacity: 0.48,
    surfaceOpacity: 0.03,
    magnetOpacity: 0.32,
    breath: 0.022,
    breathSpeed: 0.55,
    pulse: 0.08,
    wave: 0.026,
    waveSpeed: 0.65,
    orbit: 0.018,
    orbitSpeed: 0.45,
    twistSpeed: 0.032,
    rotation: 0.028,
    innerMotion: 0.01,
    curveWave: 0.045,
    curveFuzz: 0.003,
    magnetPull: 0.07,
    surfaceRipple: 0.016,
    coreOpacity: 0.06
  };
}

function statusDotClass(status: CodexFocusStatus) {
  if (status === "blocked") return "bg-amber-500 text-amber-500";
  if (status === "error" || status === "cancelled") return "bg-red-500 text-red-500";
  if (status === "complete") return "bg-emerald-500 text-emerald-500";
  if (status === "tool_running" || status === "thinking") return "bg-[#0EA5E9] text-[#0EA5E9]";
  if (status === "files_changed") return "bg-[#F05032] text-[#F05032]";
  return "bg-[#5c4ee5] text-[#5c4ee5]";
}

function focusGlowClass(status: CodexFocusStatus) {
  if (status === "thinking" || status === "tool_running") {
    return "bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.18),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(37,99,235,0.1),rgba(251,251,249,0)_44%)]";
  }
  if (status === "files_changed") {
    return "bg-[radial-gradient(circle_at_50%_42%,rgba(240,80,50,0.18),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(240,80,50,0.08),rgba(251,251,249,0)_44%)]";
  }
  if (status === "blocked") {
    return "bg-[radial-gradient(circle_at_50%_42%,rgba(217,119,6,0.14),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]";
  }
  if (status === "error" || status === "cancelled") {
    return "bg-[radial-gradient(circle_at_50%_42%,rgba(220,38,38,0.13),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]";
  }
  if (status === "complete") {
    return "bg-[radial-gradient(circle_at_50%_42%,rgba(5,150,105,0.13),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.04),rgba(251,251,249,0)_44%)]";
  }
  return "bg-[radial-gradient(circle_at_50%_42%,rgba(92,78,229,0.16),rgba(251,251,249,0)_34%),radial-gradient(circle_at_50%_58%,rgba(17,17,17,0.05),rgba(251,251,249,0)_44%)]";
}

function focusActionIcon(kind: CodexFocusAction["kind"]) {
  if (kind === "search") return "fa-magnifying-glass";
  if (kind === "command") return "fa-terminal";
  if (kind === "file") return "fa-file-code";
  if (kind === "thinking") return "fa-circle-notch";
  return "fa-bolt";
}
