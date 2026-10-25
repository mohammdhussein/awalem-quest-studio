export type Layer = "background" | "playfield" | "foreground";
export type Shape =
  | "fish"
  | "coral"
  | "rock"
  | "plant"
  | "bird"
  | "crystal"
  | "hotspot"
  | "image";
export type SceneEntity = {
  id: string;
  name: string;
  shape: Shape;
  layer: Layer;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  selectable?: boolean;
  anchor?: { x: number; y: number };
  pivot?: { x: number; y: number };
  rotation: number;
  depth: number;
  color: string;
  assetUrl?: string;
  assetPath?: string;
  assetId?: string;
  interaction?: { type: "none" | "show_fact" | "play_audio"; target?: string };
};
export type SceneDocument = {
  schema_version: 1 | 2;
  scene_id?: string;
  render_mode: "2.5d";
  world_id: string;
  volume_id: string;
  dimensions: { width: 960; height: 540 };
  entities: SceneEntity[];
};

const sample: Record<string, { shape: Shape; color: string; name: string }[]> =
  {
    sea_wonders: [
      { shape: "coral", color: "#ff7f95", name: "Coral" },
      { shape: "fish", color: "#fbd26b", name: "Example fish" },
      { shape: "plant", color: "#49bba7", name: "Seaweed" },
    ],
    jungle_kingdom: [
      { shape: "plant", color: "#45bc83", name: "Jungle plant" },
      { shape: "bird", color: "#e6b85d", name: "Example bird" },
      { shape: "rock", color: "#789a8c", name: "Boulder" },
    ],
    birds_of_the_sky: [
      { shape: "bird", color: "#ffc461", name: "Example bird" },
      { shape: "bird", color: "#e8a0df", name: "Second bird" },
      { shape: "plant", color: "#6dba9c", name: "Tree branch" },
    ],
    desert_kingdom: [
      { shape: "rock", color: "#c99068", name: "Desert rock" },
      { shape: "plant", color: "#7ba879", name: "Desert plant" },
      { shape: "crystal", color: "#ffdf99", name: "Example collectible" },
    ],
    polar_explorers: [
      { shape: "rock", color: "#a1cce7", name: "Ice formation" },
      { shape: "fish", color: "#79d0ef", name: "Example fish" },
      { shape: "crystal", color: "#bbf3ff", name: "Ice crystal" },
    ],
  };
export function makeScene(worldId: string, volumeId: string): SceneDocument {
  return {
    schema_version: 1,
    render_mode: "2.5d",
    world_id: worldId,
    volume_id: volumeId,
    dimensions: { width: 960, height: 540 },
    entities: (sample[worldId] ?? sample.sea_wonders).map((s, i) => ({
      id: `example-${i + 1}`,
      name: s.name,
      shape: s.shape,
      layer: "playfield",
      x: 290 + i * 170,
      y: 350 + (i % 2) * 58,
      scale: 1,
      rotation: 0,
      depth: 0,
      color: s.color,
      interaction: { type: "none" },
    })),
  };
}
// Legacy helpers retained for older callers. The Studio now uses the validated IndexedDB project repository.
function isScene(
  value: unknown,
  worldId: string,
  volumeId: string,
): value is SceneDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<SceneDocument>;
  return (
    doc.render_mode === "2.5d" &&
    doc.world_id === worldId &&
    doc.volume_id === volumeId &&
    Array.isArray(doc.entities)
  );
}
const key = (w: string, v: string) => `awalem-studio-25d:${w}:${v}`;
export function loadLocalScene(world: string, volume: string): SceneDocument {
  try {
    const str = window.localStorage.getItem(key(world, volume));
    if (str) {
      const data: unknown = JSON.parse(str);
      if (isScene(data, world, volume)) return data;
    }
  } catch {
    /* private mode / invalid file: use starter scene */
  }
  return makeScene(world, volume);
}
export function storeLocalScene(scene: SceneDocument): boolean {
  try {
    window.localStorage.setItem(
      key(scene.world_id, scene.volume_id),
      JSON.stringify(scene),
    );
    return true;
  } catch {
    return false;
  }
}
