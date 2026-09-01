import catalog from "../../shared/shoes.json";
import {
  PRIORITY_BRANDS,
  parseFlagCell,
  parseNumericCell,
  parseStrikeCell,
  recommendShoes,
  recommendationKind,
} from "./Shoeranking";

if (recommendationKind("unknown") !== "general") {
  throw new Error("unknown strike must return { kind: general }, not an empty list");
}
if (recommendShoes([], "midfoot").kind !== "general") {
  throw new Error("an empty catalog must stay general");
}

const reversed = [
  { brand: "Adidas", score: 40, strikes: ["midfoot" as const] },
  { brand: "Hoka", score: 99, strikes: ["midfoot" as const] },
  { brand: "Asics", score: 20, strikes: ["midfoot" as const] },
  { brand: "Nike", score: 10, strikes: ["midfoot" as const] },
  { brand: "Nike", score: 70, strikes: ["midfoot" as const] },
];
const ranked = recommendShoes(reversed, "midfoot");
if (ranked.kind !== "matched") throw new Error("reversed input should still match");
const brands = ranked.primary.map((item) => item.brand);
if (brands.join() !== PRIORITY_BRANDS.join()) {
  throw new Error(
    `reversed input must still expose ${PRIORITY_BRANDS.join(" → ")}, got ${brands.join(" → ")}`,
  );
}
if (ranked.primary[0]?.score !== 70) {
  throw new Error("Nike must be the higher-scoring pair, not the first 10-point row");
}
if (ranked.others[0]?.brand !== "Hoka") {
  throw new Error("other brands must still keep the highest non-priority score");
}

// Ties. The catalog is a CSV shared with another implementation, so the order
// the rows arrive in is not ours to control — and it used to decide the winner
// whenever two shoes scored the same.
const tied = [
  { brand: "Nike", model: "Broad", score: 50, strikes: ["any" as const] },
  { brand: "Nike", model: "Narrow", score: 50, strikes: ["midfoot" as const] },
  { brand: "Nike", model: "Middling", score: 50, strikes: ["midfoot" as const, "forefoot" as const] },
];
const bySpecificity = recommendShoes(tied, "midfoot");
if (bySpecificity.kind !== "matched" || bySpecificity.primary[0]?.model !== "Narrow") {
  throw new Error(
    `a tie must go to the row labelled for this strike, got ${
      bySpecificity.kind === "matched" ? bySpecificity.primary[0]?.model : "general"
    }`,
  );
}
const shuffled = recommendShoes([...tied].reverse(), "midfoot");
if (
  shuffled.kind !== "matched" ||
  shuffled.primary[0]?.model !== "Narrow"
) {
  throw new Error("reordering the rows changed which tied shoe won");
}
// Equally specific and equally good: settled by name, which decides nothing
// about the shoe and everything about getting the same answer twice.
const level = [
  { brand: "Asics", model: "Sky", score: 50, strikes: ["midfoot" as const] },
  { brand: "Asics", model: "Edge", score: 50, strikes: ["midfoot" as const] },
];
for (const rows of [level, [...level].reverse()]) {
  const rec = recommendShoes(rows, "midfoot");
  if (rec.kind !== "matched" || rec.primary[0]?.model !== "Edge") {
    throw new Error("a fully level tie must not depend on row order");
  }
}

if (parseNumericCell("N/A") !== null || parseNumericCell("") !== null) {
  throw new Error("N/A and blank cells must become null");
}
if (parseNumericCell("8") !== 8) {
  throw new Error("numeric cells must parse");
}
const dual = parseStrikeCell("미드풋|포어풋");
if (dual.join() !== "midfoot,forefoot") {
  throw new Error(`dual strike cell failed: ${dual.join("|")}`);
}
if (parseStrikeCell("전체").join() !== "any") {
  throw new Error("전체 must enter every strike pool as any");
}

for (const yes of ["Y", "y", " yes ", "TRUE", "1"]) {
  if (!parseFlagCell(yes)) throw new Error(`flag cell ${yes} must read as yes`);
}
// A blank cell is "not classified", and an unclassified row must score exactly
// as it did before the column existed — so everything but an explicit yes is
// no, and nothing may guess from it.
for (const no of ["", "  ", "N", "N/A", null, undefined]) {
  if (parseFlagCell(no)) throw new Error(`flag cell ${String(no)} must not read as yes`);
}

const shoes = (
  catalog as Array<{
    brand: string;
    recommendedStrikes: Array<"rearfoot" | "midfoot" | "forefoot" | "any">;
  }>
).map((shoe) => ({
  brand: shoe.brand,
  score: 1,
  strikes: shoe.recommendedStrikes,
}));

for (const strike of ["rearfoot", "midfoot", "forefoot"] as const) {
  const rec = recommendShoes(shoes, strike);
  if (rec.kind !== "matched" || rec.primary.length !== 3) {
    throw new Error(`${strike} must fill Nike, Asics, and Adidas`);
  }
  if (rec.primary.map((item) => item.brand).join() !== PRIORITY_BRANDS.join()) {
    throw new Error(`${strike} primary order drifted`);
  }
}

console.log("Shoeranking.test ok");
