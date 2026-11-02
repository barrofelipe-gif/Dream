"use strict";
const reportHeight = () =>
  window.parent.postMessage(
    { type: "bff-telegram-height", height: document.body.scrollHeight + 8 },
    window.location.origin,
  );
new ResizeObserver(reportHeight).observe(document.body);
document.addEventListener(
  "toggle",
  (event) => {
    if (event.target instanceof HTMLDialogElement && event.target.open)
      window.parent.postMessage(
        {
          type: "bff-telegram-dialog",
          top: event.target.getBoundingClientRect().top,
        },
        window.location.origin,
      );
  },
  true,
);
