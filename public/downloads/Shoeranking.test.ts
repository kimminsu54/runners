import {
  PRIORITY_BRANDS,
  preferredInPriorityOrder,
  recommendationKind,
} from "./Shoeranking";

if (recommendationKind("unknown") !== "general") {
  throw new Error("unknown strike must return { kind: general }, not an empty list");
}
if (recommendationKind(undefined) !== "general") {
  throw new Error("a missing strike must stay general");
}
if (recommendationKind("midfoot") !== "matched") {
  throw new Error("a known strike must be matched");
}

const reversed = [
  { shoe: { brand: "Adidas", model: "Boston" }, score: 40 },
  { shoe: { brand: "Hoka", model: "Clifton" }, score: 30 },
  { shoe: { brand: "Asics", model: "Novablast" }, score: 20 },
  { shoe: { brand: "Nike", model: "Pegasus" }, score: 10 },
];
const ranked = preferredInPriorityOrder(reversed);
const brands = ranked.map((pick) => pick.shoe.brand);
if (brands.join() !== PRIORITY_BRANDS.join()) {
  throw new Error(
    `reversed input must still expose ${PRIORITY_BRANDS.join(" → ")}, got ${brands.join(" → ")}`,
  );
}

const again = preferredInPriorityOrder([...reversed].reverse());
if (again.map((pick) => pick.shoe.brand).join() !== PRIORITY_BRANDS.join()) {
  throw new Error("flipping the list twice must keep Nike → Asics → Adidas");
}

console.log("Shoeranking.test ok", brands);
