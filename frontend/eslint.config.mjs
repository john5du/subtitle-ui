import { fixupConfigRules } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...fixupConfigRules(nextCoreWebVitals),
  ...fixupConfigRules(nextTypescript),
  {
    rules: {
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/immutability": "error"
    }
  }
];

export default config;
