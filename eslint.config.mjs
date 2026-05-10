import nextVitals from "eslint-config-next/core-web-vitals"

export default [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "data/**",
      "node_modules/**",
      "public/sw.js",
      "tsconfig.tsbuildinfo",
    ],
  },
  {
    rules: {
      "no-unused-vars": "off",
      "import/no-anonymous-default-export": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
]
