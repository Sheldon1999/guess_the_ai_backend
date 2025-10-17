// src/lib/rank
const RANK_TIERS = [
  { min: 5000, label: "S++" },
  { min: 1000, label: "S+" },
  { min: 500, label: "S" },
  { min: 100, label: "A" },
  { min: 80, label: "B" },
  { min: 50, label: "C" },
  { min: 20, label: "D" },
  { min: 0, label: "E" },
];

const TITLE_TIERS = [
  { min: 200, label: "Demon World Ruler" },
  { min: 120, label: "Demon Slayer" },
  { min: 100, label: "Dragon Hunter" },
  { min: 50, label: "Warrior" },
  { min: 10, label: "Newbie" },
  { min: 0, label: "Newbie" },
];

function tierLookup(value, tiers) {
  const numeric = Number(value) || 0;
  for (const tier of tiers) {
    if (numeric >= tier.min) return tier.label;
  }
  return tiers[tiers.length - 1].label;
}

function buildSwitchExpression(valueExpr, tiers) {
  const branches = [];
  for (let i = 0; i < tiers.length - 1; i += 1) {
    const tier = tiers[i];
    branches.push({
      case: { $gte: [valueExpr, tier.min] },
      then: tier.label,
    });
  }

  return {
    $switch: {
      branches,
      default: tiers[tiers.length - 1].label,
    },
  };
}

export function rankFromCorrect(n) {
  return tierLookup(n, RANK_TIERS);
}

export function titleFromStreak(s) {
  return tierLookup(s, TITLE_TIERS);
}

export function rankSwitchExpression(valueExpr = "$correctAnswers") {
  return buildSwitchExpression(valueExpr, RANK_TIERS);
}

export function titleSwitchExpression(valueExpr = "$streak") {
  return buildSwitchExpression(valueExpr, TITLE_TIERS);
}
