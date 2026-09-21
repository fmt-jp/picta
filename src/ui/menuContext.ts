import { createContext, useContext } from 'react';

/** Opens the app menu. Provided by <App>, used by every screen header. */
export const MenuContext = createContext<() => void>(() => {});

export function useMenu() {
  return useContext(MenuContext);
}
