// Business-type presets. Shared by Convex (onboarding seeding) and the UI (type picker).
// Presets only set flags + defaults; every one can be changed later in Settings → Features.

export type Feature = "units" | "attributes" | "serials" | "variants" | "expiry" | "weight" | "wholesale" | "services";

export const FEATURE_LABELS: Record<Feature, { label: string; hint: string }> = {
  units: { label: "Packs & units", hint: "Buy by carton, sell by piece (box → strip → tablet)" },
  attributes: { label: "Extra product fields", hint: "Generic name, part number, model…" },
  serials: { label: "IMEI / serial numbers", hint: "Track each phone or device, with warranty" },
  variants: { label: "Variants", hint: "Sizes and colours" },
  expiry: { label: "Expiry dates", hint: "Batches with expiry, sell oldest first" },
  weight: { label: "Sell by weight / length", hint: "kg, gram, metre" },
  wholesale: { label: "Wholesale prices", hint: "Second price for wholesale customers" },
  services: { label: "Services", hint: "Sell work with no stock (repairs, fees)" },
};

export type AttributeDef = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  searchable: boolean;
};

export type Preset = {
  key: string;
  label: string;
  icon: string; // lucide icon name, resolved in the UI
  description: string;
  features: Feature[];
  attributes: AttributeDef[];
  categories: string[];
  units: string[];
};

const text = (key: string, label: string, searchable = false): AttributeDef => ({ key, label, type: "text", searchable });
const select = (key: string, label: string, options: string[]): AttributeDef => ({ key, label, type: "select", options, searchable: false });

export const PRESETS: Preset[] = [
  {
    key: "general", label: "General shop", icon: "Store", description: "A bit of everything",
    features: ["units"], attributes: [],
    categories: ["Food", "Drinks", "Household", "Other"], units: ["pcs", "kg", "litre", "carton"],
  },
  {
    key: "grocery", label: "Grocery / mini-market", icon: "ShoppingBasket", description: "Rice, oil, sugar, drinks, snacks",
    features: ["units", "expiry", "weight", "wholesale"], attributes: [text("size", "Size")],
    categories: ["Rice & flour", "Oil", "Sugar", "Dairy", "Drinks", "Snacks", "Cleaning", "Hygiene"],
    units: ["pcs", "kg", "carton", "sack", "dozen", "litre"],
  },
  {
    key: "pharmacy", label: "Pharmacy", icon: "Pill", description: "Medicines by box, strip or tablet",
    features: ["units", "expiry", "attributes"],
    attributes: [
      text("generic", "Generic name", true),
      text("strength", "Strength"),
      select("form", "Dosage form", ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Drops", "Inhaler", "Other"]),
      text("manufacturer", "Manufacturer", true),
      select("rx", "Prescription", ["No", "Yes"]),
    ],
    categories: ["Antibiotics", "Painkillers", "Vitamins", "Baby", "First aid", "Chronic", "Devices"],
    units: ["box", "strip", "tablet", "bottle", "vial", "tube"],
  },
  {
    key: "electronics", label: "Electronics & phones", icon: "Smartphone", description: "Phones, accessories, IMEI, warranty",
    features: ["serials", "variants", "attributes", "services"],
    attributes: [text("model", "Model", true), select("condition", "Condition", ["New", "Used", "Refurbished"])],
    categories: ["Phones", "Accessories", "Chargers", "Audio", "Computers", "Parts", "Repair services"],
    units: ["pcs"],
  },
  {
    key: "mobile_money", label: "Mobile money & airtime", icon: "Wallet", description: "Airtime, data bundles, fees",
    features: ["services"], attributes: [],
    categories: ["Airtime", "Data bundles", "Fees"], units: ["pcs"],
  },
  {
    key: "clothing", label: "Clothing, shoes & fabric", icon: "Shirt", description: "Sizes, colours, fabric by metre",
    features: ["variants", "weight", "attributes"], attributes: [text("season", "Season")],
    categories: ["Men", "Women", "Kids", "Shoes", "Fabric", "Accessories"], units: ["pcs", "pair", "metre"],
  },
  {
    key: "cosmetics", label: "Cosmetics & perfume", icon: "Sparkles", description: "Perfume, oud & uunsi by weight",
    features: ["units", "weight", "expiry", "attributes"], attributes: [text("shade", "Shade / scent")],
    categories: ["Perfume", "Oud & uunsi", "Skin", "Hair", "Makeup"], units: ["pcs", "ml", "gram", "tola", "bottle"],
  },
  {
    key: "hardware", label: "Hardware & building", icon: "Hammer", description: "Cement, steel, paint, plumbing",
    features: ["units", "weight", "wholesale", "attributes"], attributes: [text("spec", "Size / grade")],
    categories: ["Cement & sand", "Steel", "Paint", "Plumbing", "Electrical", "Tools"],
    units: ["piece", "bag", "tonne", "metre", "kg"],
  },
  {
    key: "auto_parts", label: "Auto spare parts", icon: "Wrench", description: "Part numbers, vehicle fit",
    features: ["attributes", "units"],
    attributes: [
      text("partNo", "Part number", true),
      text("oemNo", "OEM number", true),
      text("fits", "Fits vehicles", true),
      select("condition", "Condition", ["New", "Used"]),
    ],
    categories: ["Engine", "Brakes", "Filters", "Electrical", "Tyres", "Oils"], units: ["pcs", "set", "pair", "litre"],
  },
  {
    key: "restaurant", label: "Restaurant / café", icon: "Coffee", description: "Meals, tea, juice",
    features: ["services"], attributes: [],
    categories: ["Meals", "Tea & coffee", "Juice", "Snacks"], units: ["plate", "cup", "pcs"],
  },
  {
    key: "bakery", label: "Bakery", icon: "Croissant", description: "Bread, cakes, pastries",
    features: ["expiry", "weight"], attributes: [],
    categories: ["Bread", "Cakes", "Pastries", "Ingredients"], units: ["pcs", "kg", "dozen"],
  },
  {
    key: "butcher", label: "Butcher", icon: "Beef", description: "Meat by the kilo",
    features: ["weight"], attributes: [],
    categories: ["Beef", "Goat", "Camel", "Chicken", "Offal"], units: ["kg"],
  },
  {
    key: "furniture", label: "Furniture & household", icon: "Sofa", description: "Beds, sofas, kitchenware",
    features: ["attributes", "serials"], attributes: [text("dimensions", "Dimensions"), text("material", "Material")],
    categories: ["Beds", "Sofas", "Tables", "Kitchenware"], units: ["pcs", "set"],
  },
  {
    key: "stationery", label: "Stationery & books", icon: "BookOpen", description: "Books, pens, paper",
    features: ["units", "attributes"], attributes: [text("isbn", "ISBN", true), text("author", "Author", true)],
    categories: ["Books", "Pens", "Paper", "School bags"], units: ["pcs", "ream", "dozen", "pack"],
  },
  {
    key: "wholesale", label: "Wholesale / distributor", icon: "Warehouse", description: "Cartons, sacks, bulk prices",
    features: ["units", "wholesale", "expiry"], attributes: [],
    categories: ["Food", "Drinks", "Household", "Hygiene"], units: ["carton", "dozen", "pcs", "sack"],
  },
  {
    key: "gas_water", label: "Gas & water", icon: "Flame", description: "LPG cylinders, water",
    features: ["units", "services"], attributes: [text("cylinderSize", "Cylinder size")],
    categories: ["LPG", "Water", "Accessories"], units: ["cylinder", "litre", "jerrycan"],
  },
  {
    key: "salon", label: "Salon / barber", icon: "Scissors", description: "Services and products",
    features: ["services"], attributes: [],
    categories: ["Hair", "Beard", "Braids", "Nails", "Products"], units: ["service", "pcs"],
  },
];

export const MAX_BUSINESS_TYPES = 3;

/** Merge the chosen presets: union of features/units/categories, attributes de-duplicated by key. */
export function mergePresets(keys: string[]) {
  const chosen = PRESETS.filter((p) => keys.includes(p.key));
  const list = chosen.length ? chosen : PRESETS.filter((p) => p.key === "general");
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const attributes = new Map<string, AttributeDef>();
  for (const p of list) for (const a of p.attributes) if (!attributes.has(a.key)) attributes.set(a.key, a);
  return {
    features: uniq(list.flatMap((p) => p.features)),
    attributes: [...attributes.values()],
    categories: uniq(list.flatMap((p) => p.categories)),
    units: uniq(list.flatMap((p) => p.units)),
  };
}

/** Features of a business; v2 rows without the field behave as a general shop with everything they already used. */
export function businessFeatures(b: { features?: Feature[] | null }): Feature[] {
  return b.features ?? ["units", "variants", "expiry", "weight", "wholesale", "services"];
}
