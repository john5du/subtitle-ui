import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: ["public/libarchive/**"]
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default config;
