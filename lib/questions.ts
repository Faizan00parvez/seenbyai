// Buyer-intent probe questions per category. {city} is interpolated at runtime.

const QUESTIONS: Record<string, string[]> = {
  Dentists: [
    "What is the best dentist in {city}?",
    "I have a terrible toothache and need a dentist in {city} who is open on weekends. Who should I call?",
    "Can you recommend an affordable dentist near downtown {city} with good reviews?",
    "Which dental clinic in {city} is best for patients with dental anxiety?",
  ],
  "Emergency plumbers": [
    "My pipe burst and I need an emergency plumber in {city} right now. Who should I call?",
    "What is the best 24-hour plumbing service in {city}?",
    "Can you recommend a reliable and affordable plumber in {city} with good reviews?",
    "Who is the most trusted plumber in {city} for boiler repairs?",
  ],
  Roofers: [
    "What is the best roofing company in {city}?",
    "I need my roof replaced in {city}. Who should I hire?",
    "Can you recommend an affordable roofer in {city} with good reviews?",
    "Which roofing contractor in {city} is best for storm damage repairs?",
  ],
  "Immigration & injury lawyers": [
    "What is the best immigration lawyer in {city}?",
    "I was in a car accident in {city} and need a personal injury lawyer. Who should I call?",
    "Can you recommend an affordable immigration attorney in {city} with good reviews?",
    "Which law firm in {city} is best for visa and work permit cases?",
  ],
  "Med spas": [
    "What is the best med spa in {city}?",
    "Where can I get lip fillers in {city} from a reputable clinic?",
    "Can you recommend an affordable aesthetic clinic in {city} with good reviews?",
    "Which med spa in {city} is best for laser hair removal?",
  ],
};

const GENERIC_FALLBACK = [
  "What is the best {category} in {city}?",
  "I urgently need a {category} in {city}. Who should I call?",
  "Can you recommend an affordable {category} in {city} with good reviews?",
  "Which {category} in {city} is the most trusted by locals?",
];

export const CATEGORIES = Object.keys(QUESTIONS);

export function getQuestions(category: string, city: string): string[] {
  const templates = QUESTIONS[category] ?? GENERIC_FALLBACK;
  return templates.map((t) =>
    t.replaceAll("{city}", city).replaceAll("{category}", category.toLowerCase())
  );
}
