import manifest from '../../content/worlds/manifest.json';
export type World = { id: string; name: string; unlock_level: number; volumes: { id: string; title: string; sort_order: number; is_active: boolean; card_limit: number }[] };
export const worlds = manifest.worlds as World[];
