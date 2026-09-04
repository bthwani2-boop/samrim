export const semanticTokens = {
  color: {
    trustedStructure: "#0A2F5C",
    primaryAction: "#FF500D",
    warmBackground: "#FFFCF8",
    primarySurface: "#FFFFFF",
  },
} as const;

export type SemanticTokens = typeof semanticTokens;
