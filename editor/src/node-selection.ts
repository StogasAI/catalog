import { createContext } from 'svelte';

export const [getNodeSelection, setNodeSelection] = createContext<(id: string) => void>();
