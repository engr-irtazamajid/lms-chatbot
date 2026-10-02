// Example questions for the prompt library and the empty state. They name current content,
// so update them when courses change (the bot itself never hard-codes course names).
export const PROMPTS: { group: string; items: string[] }[] = [
  { group: 'Catalog', items: ['What courses do you have?', 'What modules are in Basic - Foundations?', 'How long is the security module?'] },
  { group: 'Topics', items: ['Tell me about B05', 'What is module A about?', 'Which module covers spec-driven development?'] },
  { group: 'Ask the material', items: ['What is context rot?', 'How do I stop the model hallucinating?', 'Where can I learn about prompt injection?'] },
]
