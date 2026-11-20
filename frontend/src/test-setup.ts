import "@testing-library/jest-dom/vitest";

// jsdom 25's Blob implements only slice/size/type, so a Response.blob() in this
// environment is not a WHATWG Blob. Restore the standard method instead of
// weakening assertions that read real downloaded bytes.
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("Blob could not be read."));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
