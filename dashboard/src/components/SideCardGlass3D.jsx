import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";

export function SideCardGlass3D({ position }) {
  const side = position === "left" ? -1 : 1;
  return (
    <i className={`side-card-shell-3d shell-${position}`} aria-hidden="true">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 6], zoom: 90 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <SideShellScene side={side} />
      </Canvas>
    </i>
  );
}

function SideShellScene({ side }) {
  const group = useRef(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.z = side * (0.018 + Math.sin(clock.elapsedTime * 0.45) * 0.003);
  });

  return (
    <>
      <ambientLight intensity={0.62} />
      <directionalLight position={[side * -3.2, 2.4, 4.8]} intensity={1.15} color="#dff4ff" />
      <pointLight position={[side * -2.5, -1.6, 2.5]} intensity={2.4} color="#46e4ff" />
      <group ref={group} rotation={[0, side * 0.36, side * 0.018]} scale={[1.12, 1.03, 1]}>
        <RoundedBox args={[4.8, 3.6, 0.16]} radius={0.15} smoothness={24}>
          <meshPhysicalMaterial
            color="#061522"
            roughness={0.32}
            metalness={0.08}
            clearcoat={0.48}
            clearcoatRoughness={0.24}
            transparent
            opacity={0.34}
            transmission={0.04}
            thickness={0.52}
            ior={1.38}
            envMapIntensity={0.72}
          />
        </RoundedBox>
      </group>
    </>
  );
}
