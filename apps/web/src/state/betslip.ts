import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SlipPick {
  eventId: string;
  selectionId: string;
  pick: string;
  match: string;
  odds: number;
}

interface SlipState {
  picks: SlipPick[];
  stakeKes: number;
  toggle: (p: SlipPick) => void;
  remove: (selectionId: string) => void;
  clear: () => void;
  setStake: (kes: number) => void;
  updateOdds: (changes: { selectionId: string; odds: number }[]) => void;
}

/** One pick per match: choosing another outcome on the same match replaces the old one. */
export const useSlip = create<SlipState>()(
  persist(
    (set) => ({
      picks: [],
      stakeKes: 100,
      toggle: (p) =>
        set((s) => {
          if (s.picks.some((x) => x.selectionId === p.selectionId)) return { picks: s.picks.filter((x) => x.selectionId !== p.selectionId) };
          return { picks: [...s.picks.filter((x) => x.eventId !== p.eventId), p] };
        }),
      remove: (id) => set((s) => ({ picks: s.picks.filter((x) => x.selectionId !== id) })),
      clear: () => set({ picks: [] }),
      setStake: (kes) => set({ stakeKes: kes }),
      updateOdds: (changes) =>
        set((s) => ({ picks: s.picks.map((p) => ({ ...p, odds: changes.find((c) => c.selectionId === p.selectionId)?.odds ?? p.odds })) }))
    }),
    { name: 'eb-slip' }
  )
);
