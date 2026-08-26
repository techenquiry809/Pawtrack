/**
 * Standardized dog breed catalogue.
 *
 * WHY THIS EXISTS: breed must never be free text. If owners type it, the
 * dataset fills with 'Golden Retreiver', 'golden retriver' and 'Golder
 * Retriever' and becomes ungroupable. Selection from this list guarantees one
 * canonical spelling per breed, with a stable slug that survives display-name
 * edits.
 *
 * WHY IT IS NOT COSMETIC: median age of onset for canine idiopathic epilepsy
 * is around 2.5 years, and predisposition is documented for a specific set of
 * breeds. This value ends up on a vet report beside a date of birth and a
 * seizure history, so it is clinical context, not decoration.
 *
 * WHY IT IS BUNDLED, NOT FETCHED: the app is offline-first. A breed picker
 * that needs a network call fails in a vet's basement.
 *
 * ── PROVENANCE: READ BEFORE TRUSTING THE COUNT ────────────────────────
 * This list holds 235 breeds under the source tag 'curated-v1', and that
 * number matches no registry: the FCI recognises ~350 and the AKC ~277. It is
 * a hand-curated list of unknown origin.
 *
 * Its SHAPE, however, is clearly AKC-derived, not FCI:
 *   - Belgian Shepherd is split into Malinois / Sheepdog / Tervuren, which is
 *     AKC practice; the FCI treats them as one breed with four varieties.
 *   - Poodle is split into Standard / Miniature / Toy, likewise AKC.
 *
 * So if you replace it, target AKC nomenclature (e.g. tmfilho/akcdata, 277
 * breeds) rather than FCI, or every stored breed_id from this list breaks.
 * See scripts/build-breeds.ts, and check the source licence first: breed names
 * are facts and not copyrightable, but a compiled database can carry sui
 * generis database rights in the EU.
 *
 * KNOWN DEFECT: 'cocker-spaniel', 'american-cocker-spaniel' and
 * 'english-cocker-spaniel' all exist. AKC recognises only the first (which IS
 * the American) and the third. The middle one is a duplicate concept and
 * should be merged when the list is regenerated — not deleted by hand, since
 * a stored breed_id pointing at it would be orphaned.
 */

/** Provenance of the standardized value. Surfaced in the picker footer. */
export const BREED_SOURCE = 'curated-v1';

export type BreedKind = 'standard' | 'mixed' | 'unknown' | 'other';

export type BreedOption = {
  /** Stable slug. This is what SQLite stores in dogs.breed_id. */
  breedId: string;
  /**
   * Canonical stored name. NEVER reword these — they are written verbatim to
   * the database, so a rename orphans every historical record that used it.
   * For display, prefer `pickerLabel` where one is set.
   */
  breedName: string;
  kind?: BreedKind;
  /** Friendlier label for the picker only. Never stored. */
  pickerLabel?: string;
};

/**
 * Pinned to the TOP of the picker, not buried under 235 alphabetical entries.
 *
 * Mixed and unknown-origin dogs — often the rescues whose owners most need
 * this app — should not have to scroll past Affenpinscher to find themselves.
 *
 * NOTE the split between `breedName` and `pickerLabel`. "I don't know" reads
 * far better than "Unknown" on screen, but 'Unknown' is what already sits in
 * the database and in breedDisplay(), so the stored string does not move.
 */
export const SPECIAL_BREEDS: BreedOption[] = [
  {
    breedId: 'mixed-breed',
    breedName: 'Mixed Breed',
    pickerLabel: 'Mixed breed',
    kind: 'mixed',
  },
  {
    breedId: 'unknown',
    breedName: 'Unknown',
    pickerLabel: "I don't know",
    kind: 'unknown',
  },
  {
    breedId: 'other',
    breedName: 'Other',
    pickerLabel: 'Something else',
    kind: 'other',
  },
];

/**
 * Alternate names people actually type. Searched, never displayed.
 *
 * Kept as a map rather than a field on each entry because the two have
 * different lifecycles: BREED_LIST is generated from a registry, while these
 * are hand-curated from what real owners type. Regenerating one must not
 * clobber the other.
 *
 * Add to this every time a support ticket reveals a new one.
 */
export const BREED_ALIASES: Record<string, string[]> = {
  'german-shepherd-dog': ['alsatian', 'gsd', 'german shepard'],
  dachshund: ['sausage dog', 'wiener dog', 'doxie', 'teckel'],
  'labrador-retriever': ['lab', 'labrador'],
  'golden-retriever': ['golden', 'goldie'],
  'belgian-malinois': ['malinois', 'mal'],
  'belgian-tervuren': ['tervuren', 'terv'],
  'belgian-sheepdog': ['groenendael'],
  'staffordshire-bull-terrier': ['staffy', 'staffie'],
  'yorkshire-terrier': ['yorkie'],
  rottweiler: ['rottie'],
  'doberman-pinscher': ['dobermann', 'dobie'],
  'west-highland-white-terrier': ['westie'],
  'cavalier-king-charles-spaniel': ['cavalier', 'ckcs'],
  'shetland-sheepdog': ['sheltie'],
  'pembroke-welsh-corgi': ['corgi'],
  'chinese-shar-pei': ['shar pei', 'sharpei'],
  'bichon-frise': ['bichon'],
  'mixed-breed': ['mutt', 'crossbreed', 'cross breed', 'mongrel', 'mix'],
  unknown: ['not sure', 'unsure', 'no idea', 'dont know', "don't know"],
  other: ['not listed', 'something else'],
};

/**
 * Shown above the full list before the owner types anything. Most people
 * finish here.
 *
 * Ordered by documented epilepsy prevalence, NOT general popularity — the
 * population installing a seizure tracker is not the general dog population.
 * The ordering is invisible; it just means the breed they need is usually
 * already on screen.
 */
export const QUICK_PICK_IDS: string[] = [
  'labrador-retriever',
  'golden-retriever',
  'border-collie',
  'german-shepherd-dog',
  'beagle',
  'boxer',
  'cocker-spaniel',
  'bernese-mountain-dog',
  'dachshund',
  'belgian-tervuren',
  'english-springer-spaniel',
  'vizsla',
];

/**
 * Breeds with published evidence of predisposition to idiopathic epilepsy.
 *
 * Sources: Cornell Riney Canine Health Center; International Veterinary
 * Epilepsy Task Force consensus (BMC Vet Res, 2015).
 *
 * *** PRODUCT DECISION: NEVER RENDER THIS IN THE PICKER. ***
 *
 * Badging a breed "epilepsy-prone" during onboarding does two harmful things:
 * it alarms an owner who has no diagnosis yet, and it edges the app toward
 * implying one. This is population-level epidemiology — it says nothing about
 * the dog in front of you, and a frightened owner will not read it that way.
 * It is also the single clearest way to violate the rule at the top of
 * docs/ARCHITECTURE.md.
 *
 * Legitimate uses: ordering QUICK_PICK_IDS above, and an aggregate research
 * export with explicit consent. Nothing else.
 *
 * NOTE ON BELGIAN BREEDS: the genetic evidence names the Belgian Tervuren
 * specifically. Because this list is AKC-shaped, that is 'belgian-tervuren'
 * and not the FCI's merged 'belgian-shepherd-dog', which does not exist here.
 */
export const EPILEPSY_PREDISPOSED: ReadonlySet<string> = new Set([
  'beagle',
  'belgian-tervuren',
  'bernese-mountain-dog',
  'border-collie',
  'boxer',
  'cocker-spaniel',
  'dachshund',
  'dalmatian',
  'english-springer-spaniel',
  'german-shepherd-dog',
  'golden-retriever',
  'irish-setter',
  'keeshond',
  'labrador-retriever',
  'vizsla',
]);

export const BREED_LIST: BreedOption[] = [
  { breedId: "affenpinscher", breedName: "Affenpinscher" },
  { breedId: "afghan-hound", breedName: "Afghan Hound" },
  { breedId: "airedale-terrier", breedName: "Airedale Terrier" },
  { breedId: "akbash", breedName: "Akbash" },
  { breedId: "akita", breedName: "Akita" },
  { breedId: "alaskan-klee-kai", breedName: "Alaskan Klee Kai" },
  { breedId: "alaskan-malamute", breedName: "Alaskan Malamute" },
  { breedId: "american-bulldog", breedName: "American Bulldog" },
  { breedId: "american-cocker-spaniel", breedName: "American Cocker Spaniel" },
  { breedId: "american-english-coonhound", breedName: "American English Coonhound" },
  { breedId: "american-eskimo-dog", breedName: "American Eskimo Dog" },
  { breedId: "american-foxhound", breedName: "American Foxhound" },
  { breedId: "american-hairless-terrier", breedName: "American Hairless Terrier" },
  { breedId: "american-pit-bull-terrier", breedName: "American Pit Bull Terrier" },
  { breedId: "american-staffordshire-terrier", breedName: "American Staffordshire Terrier" },
  { breedId: "american-water-spaniel", breedName: "American Water Spaniel" },
  { breedId: "anatolian-shepherd-dog", breedName: "Anatolian Shepherd Dog" },
  { breedId: "appenzeller-sennenhund", breedName: "Appenzeller Sennenhund" },
  { breedId: "australian-cattle-dog", breedName: "Australian Cattle Dog" },
  { breedId: "australian-kelpie", breedName: "Australian Kelpie" },
  { breedId: "australian-shepherd", breedName: "Australian Shepherd" },
  { breedId: "australian-terrier", breedName: "Australian Terrier" },
  { breedId: "azawakh", breedName: "Azawakh" },
  { breedId: "basenji", breedName: "Basenji" },
  { breedId: "basset-fauve-de-bretagne", breedName: "Basset Fauve de Bretagne" },
  { breedId: "basset-hound", breedName: "Basset Hound" },
  { breedId: "bavarian-mountain-hound", breedName: "Bavarian Mountain Hound" },
  { breedId: "beagle", breedName: "Beagle" },
  { breedId: "bearded-collie", breedName: "Bearded Collie" },
  { breedId: "beauceron", breedName: "Beauceron" },
  { breedId: "bedlington-terrier", breedName: "Bedlington Terrier" },
  { breedId: "belgian-malinois", breedName: "Belgian Malinois" },
  { breedId: "belgian-sheepdog", breedName: "Belgian Sheepdog" },
  { breedId: "belgian-tervuren", breedName: "Belgian Tervuren" },
  { breedId: "bergamasco-sheepdog", breedName: "Bergamasco Sheepdog" },
  { breedId: "berger-picard", breedName: "Berger Picard" },
  { breedId: "bernese-mountain-dog", breedName: "Bernese Mountain Dog" },
  { breedId: "bichon-frise", breedName: "Bichon Frise" },
  { breedId: "black-and-tan-coonhound", breedName: "Black and Tan Coonhound" },
  { breedId: "black-russian-terrier", breedName: "Black Russian Terrier" },
  { breedId: "bloodhound", breedName: "Bloodhound" },
  { breedId: "bluetick-coonhound", breedName: "Bluetick Coonhound" },
  { breedId: "boerboel", breedName: "Boerboel" },
  { breedId: "bolognese", breedName: "Bolognese" },
  { breedId: "border-collie", breedName: "Border Collie" },
  { breedId: "border-terrier", breedName: "Border Terrier" },
  { breedId: "borzoi", breedName: "Borzoi" },
  { breedId: "boston-terrier", breedName: "Boston Terrier" },
  { breedId: "bouvier-des-flandres", breedName: "Bouvier des Flandres" },
  { breedId: "boxer", breedName: "Boxer" },
  { breedId: "boykin-spaniel", breedName: "Boykin Spaniel" },
  { breedId: "bracco-italiano", breedName: "Bracco Italiano" },
  { breedId: "briard", breedName: "Briard" },
  { breedId: "brittany", breedName: "Brittany" },
  { breedId: "brussels-griffon", breedName: "Brussels Griffon" },
  { breedId: "bull-terrier", breedName: "Bull Terrier" },
  { breedId: "bulldog", breedName: "Bulldog" },
  { breedId: "bullmastiff", breedName: "Bullmastiff" },
  { breedId: "cairn-terrier", breedName: "Cairn Terrier" },
  { breedId: "canaan-dog", breedName: "Canaan Dog" },
  { breedId: "cane-corso", breedName: "Cane Corso" },
  { breedId: "cardigan-welsh-corgi", breedName: "Cardigan Welsh Corgi" },
  { breedId: "carolina-dog", breedName: "Carolina Dog" },
  { breedId: "catahoula-leopard-dog", breedName: "Catahoula Leopard Dog" },
  { breedId: "cavalier-king-charles-spaniel", breedName: "Cavalier King Charles Spaniel" },
  { breedId: "central-asian-shepherd-dog", breedName: "Central Asian Shepherd Dog" },
  { breedId: "cesky-terrier", breedName: "Cesky Terrier" },
  { breedId: "chesapeake-bay-retriever", breedName: "Chesapeake Bay Retriever" },
  { breedId: "chihuahua", breedName: "Chihuahua" },
  { breedId: "chinese-crested", breedName: "Chinese Crested" },
  { breedId: "chinese-shar-pei", breedName: "Chinese Shar-Pei" },
  { breedId: "chinook", breedName: "Chinook" },
  { breedId: "chow-chow", breedName: "Chow Chow" },
  { breedId: "cirneco-dell-etna", breedName: "Cirneco dell'Etna" },
  { breedId: "clumber-spaniel", breedName: "Clumber Spaniel" },
  { breedId: "cocker-spaniel", breedName: "Cocker Spaniel" },
  { breedId: "collie", breedName: "Collie" },
  { breedId: "coton-de-tulear", breedName: "Coton de Tulear" },
  { breedId: "curly-coated-retriever", breedName: "Curly-Coated Retriever" },
  { breedId: "dachshund", breedName: "Dachshund" },
  { breedId: "dalmatian", breedName: "Dalmatian" },
  { breedId: "dandie-dinmont-terrier", breedName: "Dandie Dinmont Terrier" },
  { breedId: "doberman-pinscher", breedName: "Doberman Pinscher" },
  { breedId: "dogo-argentino", breedName: "Dogo Argentino" },
  { breedId: "dogue-de-bordeaux", breedName: "Dogue de Bordeaux" },
  { breedId: "dutch-shepherd", breedName: "Dutch Shepherd" },
  { breedId: "english-cocker-spaniel", breedName: "English Cocker Spaniel" },
  { breedId: "english-foxhound", breedName: "English Foxhound" },
  { breedId: "english-setter", breedName: "English Setter" },
  { breedId: "english-springer-spaniel", breedName: "English Springer Spaniel" },
  { breedId: "english-toy-spaniel", breedName: "English Toy Spaniel" },
  { breedId: "entlebucher-mountain-dog", breedName: "Entlebucher Mountain Dog" },
  { breedId: "estrela-mountain-dog", breedName: "Estrela Mountain Dog" },
  { breedId: "field-spaniel", breedName: "Field Spaniel" },
  { breedId: "finnish-lapphund", breedName: "Finnish Lapphund" },
  { breedId: "finnish-spitz", breedName: "Finnish Spitz" },
  { breedId: "flat-coated-retriever", breedName: "Flat-Coated Retriever" },
  { breedId: "french-bulldog", breedName: "French Bulldog" },
  { breedId: "french-spaniel", breedName: "French Spaniel" },
  { breedId: "german-longhaired-pointer", breedName: "German Longhaired Pointer" },
  { breedId: "german-pinscher", breedName: "German Pinscher" },
  { breedId: "german-shepherd-dog", breedName: "German Shepherd Dog" },
  { breedId: "german-shorthaired-pointer", breedName: "German Shorthaired Pointer" },
  { breedId: "german-spitz", breedName: "German Spitz" },
  { breedId: "german-wirehaired-pointer", breedName: "German Wirehaired Pointer" },
  { breedId: "giant-schnauzer", breedName: "Giant Schnauzer" },
  { breedId: "glen-of-imaal-terrier", breedName: "Glen of Imaal Terrier" },
  { breedId: "golden-retriever", breedName: "Golden Retriever" },
  { breedId: "gordon-setter", breedName: "Gordon Setter" },
  { breedId: "grand-basset-griffon-vend-en", breedName: "Grand Basset Griffon Vendéen" },
  { breedId: "great-dane", breedName: "Great Dane" },
  { breedId: "great-pyrenees", breedName: "Great Pyrenees" },
  { breedId: "greater-swiss-mountain-dog", breedName: "Greater Swiss Mountain Dog" },
  { breedId: "greyhound", breedName: "Greyhound" },
  { breedId: "griffon-bruxellois", breedName: "Griffon Bruxellois" },
  { breedId: "harrier", breedName: "Harrier" },
  { breedId: "havanese", breedName: "Havanese" },
  { breedId: "hokkaido", breedName: "Hokkaido" },
  { breedId: "hovawart", breedName: "Hovawart" },
  { breedId: "ibizan-hound", breedName: "Ibizan Hound" },
  { breedId: "icelandic-sheepdog", breedName: "Icelandic Sheepdog" },
  { breedId: "irish-red-and-white-setter", breedName: "Irish Red and White Setter" },
  { breedId: "irish-setter", breedName: "Irish Setter" },
  { breedId: "irish-terrier", breedName: "Irish Terrier" },
  { breedId: "irish-water-spaniel", breedName: "Irish Water Spaniel" },
  { breedId: "irish-wolfhound", breedName: "Irish Wolfhound" },
  { breedId: "italian-greyhound", breedName: "Italian Greyhound" },
  { breedId: "jack-russell-terrier", breedName: "Jack Russell Terrier" },
  { breedId: "japanese-chin", breedName: "Japanese Chin" },
  { breedId: "japanese-spitz", breedName: "Japanese Spitz" },
  { breedId: "jindo", breedName: "Jindo" },
  { breedId: "karelian-bear-dog", breedName: "Karelian Bear Dog" },
  { breedId: "keeshond", breedName: "Keeshond" },
  { breedId: "kerry-blue-terrier", breedName: "Kerry Blue Terrier" },
  { breedId: "king-charles-spaniel", breedName: "King Charles Spaniel" },
  { breedId: "kishu-ken", breedName: "Kishu Ken" },
  { breedId: "komondor", breedName: "Komondor" },
  { breedId: "kooikerhondje", breedName: "Kooikerhondje" },
  { breedId: "kuvasz", breedName: "Kuvasz" },
  { breedId: "labrador-retriever", breedName: "Labrador Retriever" },
  { breedId: "lagotto-romagnolo", breedName: "Lagotto Romagnolo" },
  { breedId: "lakeland-terrier", breedName: "Lakeland Terrier" },
  { breedId: "lancashire-heeler", breedName: "Lancashire Heeler" },
  { breedId: "leonberger", breedName: "Leonberger" },
  { breedId: "lhasa-apso", breedName: "Lhasa Apso" },
  { breedId: "l-wchen", breedName: "Löwchen" },
  { breedId: "maltese", breedName: "Maltese" },
  { breedId: "manchester-terrier", breedName: "Manchester Terrier" },
  { breedId: "maremma-sheepdog", breedName: "Maremma Sheepdog" },
  { breedId: "mastiff", breedName: "Mastiff" },
  { breedId: "miniature-american-shepherd", breedName: "Miniature American Shepherd" },
  { breedId: "miniature-bull-terrier", breedName: "Miniature Bull Terrier" },
  { breedId: "miniature-pinscher", breedName: "Miniature Pinscher" },
  { breedId: "miniature-schnauzer", breedName: "Miniature Schnauzer" },
  { breedId: "mudi", breedName: "Mudi" },
  { breedId: "neapolitan-mastiff", breedName: "Neapolitan Mastiff" },
  { breedId: "new-zealand-huntaway", breedName: "New Zealand Huntaway" },
  { breedId: "newfoundland", breedName: "Newfoundland" },
  { breedId: "norfolk-terrier", breedName: "Norfolk Terrier" },
  { breedId: "norwegian-buhund", breedName: "Norwegian Buhund" },
  { breedId: "norwegian-elkhound", breedName: "Norwegian Elkhound" },
  { breedId: "norwegian-lundehund", breedName: "Norwegian Lundehund" },
  { breedId: "norwich-terrier", breedName: "Norwich Terrier" },
  { breedId: "nova-scotia-duck-tolling-retriever", breedName: "Nova Scotia Duck Tolling Retriever" },
  { breedId: "old-english-sheepdog", breedName: "Old English Sheepdog" },
  { breedId: "otterhound", breedName: "Otterhound" },
  { breedId: "papillon", breedName: "Papillon" },
  { breedId: "parson-russell-terrier", breedName: "Parson Russell Terrier" },
  { breedId: "pekingese", breedName: "Pekingese" },
  { breedId: "pembroke-welsh-corgi", breedName: "Pembroke Welsh Corgi" },
  { breedId: "perro-de-presa-canario", breedName: "Perro de Presa Canario" },
  { breedId: "petit-basset-griffon-vend-en", breedName: "Petit Basset Griffon Vendéen" },
  { breedId: "pharaoh-hound", breedName: "Pharaoh Hound" },
  { breedId: "plott-hound", breedName: "Plott Hound" },
  { breedId: "pointer", breedName: "Pointer" },
  { breedId: "polish-lowland-sheepdog", breedName: "Polish Lowland Sheepdog" },
  { breedId: "pomeranian", breedName: "Pomeranian" },
  { breedId: "poodle-standard", breedName: "Poodle (Standard)" },
  { breedId: "poodle-miniature", breedName: "Poodle (Miniature)" },
  { breedId: "poodle-toy", breedName: "Poodle (Toy)" },
  { breedId: "portuguese-podengo", breedName: "Portuguese Podengo" },
  { breedId: "portuguese-water-dog", breedName: "Portuguese Water Dog" },
  { breedId: "pug", breedName: "Pug" },
  { breedId: "puli", breedName: "Puli" },
  { breedId: "pumi", breedName: "Pumi" },
  { breedId: "pyrenean-shepherd", breedName: "Pyrenean Shepherd" },
  { breedId: "rat-terrier", breedName: "Rat Terrier" },
  { breedId: "redbone-coonhound", breedName: "Redbone Coonhound" },
  { breedId: "rhodesian-ridgeback", breedName: "Rhodesian Ridgeback" },
  { breedId: "rottweiler", breedName: "Rottweiler" },
  { breedId: "russell-terrier", breedName: "Russell Terrier" },
  { breedId: "russian-toy", breedName: "Russian Toy" },
  { breedId: "saint-bernard", breedName: "Saint Bernard" },
  { breedId: "saluki", breedName: "Saluki" },
  { breedId: "samoyed", breedName: "Samoyed" },
  { breedId: "schipperke", breedName: "Schipperke" },
  { breedId: "scottish-deerhound", breedName: "Scottish Deerhound" },
  { breedId: "scottish-terrier", breedName: "Scottish Terrier" },
  { breedId: "sealyham-terrier", breedName: "Sealyham Terrier" },
  { breedId: "shetland-sheepdog", breedName: "Shetland Sheepdog" },
  { breedId: "shiba-inu", breedName: "Shiba Inu" },
  { breedId: "shih-tzu", breedName: "Shih Tzu" },
  { breedId: "shikoku", breedName: "Shikoku" },
  { breedId: "siberian-husky", breedName: "Siberian Husky" },
  { breedId: "silky-terrier", breedName: "Silky Terrier" },
  { breedId: "skye-terrier", breedName: "Skye Terrier" },
  { breedId: "sloughi", breedName: "Sloughi" },
  { breedId: "small-munsterlander-pointer", breedName: "Small Munsterlander Pointer" },
  { breedId: "smooth-fox-terrier", breedName: "Smooth Fox Terrier" },
  { breedId: "soft-coated-wheaten-terrier", breedName: "Soft Coated Wheaten Terrier" },
  { breedId: "spanish-water-dog", breedName: "Spanish Water Dog" },
  { breedId: "spinone-italiano", breedName: "Spinone Italiano" },
  { breedId: "staffordshire-bull-terrier", breedName: "Staffordshire Bull Terrier" },
  { breedId: "standard-schnauzer", breedName: "Standard Schnauzer" },
  { breedId: "sussex-spaniel", breedName: "Sussex Spaniel" },
  { breedId: "swedish-vallhund", breedName: "Swedish Vallhund" },
  { breedId: "tibetan-mastiff", breedName: "Tibetan Mastiff" },
  { breedId: "tibetan-spaniel", breedName: "Tibetan Spaniel" },
  { breedId: "tibetan-terrier", breedName: "Tibetan Terrier" },
  { breedId: "toy-fox-terrier", breedName: "Toy Fox Terrier" },
  { breedId: "transylvanian-hound", breedName: "Transylvanian Hound" },
  { breedId: "treeing-walker-coonhound", breedName: "Treeing Walker Coonhound" },
  { breedId: "vizsla", breedName: "Vizsla" },
  { breedId: "volpino-italiano", breedName: "Volpino Italiano" },
  { breedId: "weimaraner", breedName: "Weimaraner" },
  { breedId: "welsh-springer-spaniel", breedName: "Welsh Springer Spaniel" },
  { breedId: "welsh-terrier", breedName: "Welsh Terrier" },
  { breedId: "west-highland-white-terrier", breedName: "West Highland White Terrier" },
  { breedId: "whippet", breedName: "Whippet" },
  { breedId: "wire-fox-terrier", breedName: "Wire Fox Terrier" },
  { breedId: "wirehaired-pointing-griffon", breedName: "Wirehaired Pointing Griffon" },
  { breedId: "wirehaired-vizsla", breedName: "Wirehaired Vizsla" },
  { breedId: "xoloitzcuintli", breedName: "Xoloitzcuintli" },
  { breedId: "yakutian-laika", breedName: "Yakutian Laika" },
  { breedId: "yorkshire-terrier", breedName: "Yorkshire Terrier" },];

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Accent- and case-folding.
 *
 * This matters more than it looks. Several names carry diacritics (Löwchen,
 * Coton de Tuléar, Bracco Italiano). An owner typing "lowchen" on a phone
 * keyboard must find Löwchen, and normalising to NFD then stripping combining
 * marks is the cheap way to guarantee it.
 */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const displayName = (b: BreedOption): string => b.pickerLabel ?? b.breedName;

/**
 * Case-insensitive, accent-insensitive, alias-aware search.
 *
 * Ranked prefix-first, then substring, then alias. Someone typing "col" wants
 * Collie before Bearded Collie, and neither before Cocker Spaniel.
 *
 * Special values participate in the search but are NOT force-appended to every
 * result set — that would put "Mixed breed" under every query. Keeping them
 * reachable when a search matches nothing is the caller's job: see the empty
 * state in app/breed-picker.tsx, which renders them inline.
 */
export function searchBreeds(query: string, list: BreedOption[] = BREED_LIST): BreedOption[] {
  const q = normalize(query);
  if (!q) return [...SPECIAL_BREEDS, ...list];

  const prefix: BreedOption[] = [];
  const substring: BreedOption[] = [];
  const aliased: BreedOption[] = [];

  for (const breed of [...SPECIAL_BREEDS, ...list]) {
    const name = normalize(displayName(breed));
    if (name.startsWith(q)) {
      prefix.push(breed);
      continue;
    }
    if (name.includes(q)) {
      substring.push(breed);
      continue;
    }
    const aliases = BREED_ALIASES[breed.breedId];
    if (aliases?.some((a) => normalize(a).includes(q))) aliased.push(breed);
  }

  return [...prefix, ...substring, ...aliased];
}

/** Quick picks, resolved against the real list so a bad id cannot ship silently. */
export function quickPicks(): BreedOption[] {
  return QUICK_PICK_IDS.map((id) =>
    BREED_LIST.find((b) => b.breedId === id),
  ).filter((b): b is BreedOption => b !== undefined);
}

// A slug referenced by QUICK_PICK_IDS or EPILEPSY_PREDISPOSED that does not
// exist in BREED_LIST is silent breakage — an empty quick-pick row, or
// research metadata pointing at nothing. Fail loudly in development.
if (__DEV__) {
  const known = new Set(BREED_LIST.map((b) => b.breedId));
  const missing = [...QUICK_PICK_IDS, ...EPILEPSY_PREDISPOSED].filter(
    (id) => !known.has(id),
  );
  if (missing.length > 0) {
    console.error(
      `[breeds] ${missing.length} referenced breed id(s) are not in BREED_LIST: ${missing.join(', ')}`,
    );
  }
}
