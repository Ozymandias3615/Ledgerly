let listeners = [];
let idCounter = 0;

function emit(message, type) {
  const id = ++idCounter;
  listeners.forEach((fn) => fn({ id, message, type }));
}

export const toast = {
  success: (message) => emit(message, "success"),
  error: (message) => emit(message, "error"),
};

export function subscribeToasts(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
