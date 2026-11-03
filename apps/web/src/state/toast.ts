import { create } from 'zustand';

type Tone = 'ok' | 'bad' | 'gold';
interface ToastState {
  message: string | null;
  tone: Tone;
  show: (message: string, tone?: Tone) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
export const useToast = create<ToastState>()((set) => ({
  message: null,
  tone: 'ok',
  show: (message, tone = 'ok') => {
    clearTimeout(timer);
    set({ message, tone });
    timer = setTimeout(() => set({ message: null }), 4000);
  }
}));
