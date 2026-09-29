import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/** Discard account-local drafts without remounting public authentication pages. */
export function useIdentityState<T>(identity: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [box, setBox] = useState({ identity, value: initial });
  // React retries this component before committing children. No frame of an
  // earlier identity's state is exposed while waiting for an effect to run.
  if (box.identity !== identity) setBox({ identity, value: initial });
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setBox((current) => {
      // A retained async callback from the previous identity cannot repopulate
      // the new account's local state after the reset.
      if (current.identity !== identity) return current;
      const value = typeof next === 'function' ? (next as (previous: T) => T)(current.value) : next;
      return { identity, value };
    });
  }, [identity]);
  return [box.identity === identity ? box.value : initial, setValue];
}
