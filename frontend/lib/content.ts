// Deccan House — brand copy and structured content used across the site.

export const BRAND = {
  name: "Deccan House",
  tagline: "A contemporary café where Hyderabad's heritage meets modern culinary culture.",
  area: "Jubilee Hills",
  city: "Hyderabad, Telangana",
  address: "Road No. 36, Jubilee Hills, Hyderabad, Telangana 500033",
  phone: "+91 40 4000 3636",
  whatsapp: "914040003636",
  email: "hello@deccanhouse.cafe",
  instagram: "deccanhouse.cafe",
  hours: [
    { days: "Mon – Fri", time: "7:00 AM – 11:00 PM" },
    { days: "Sat – Sun", time: "7:00 AM – 12:00 AM" },
  ],
  // Jubilee Hills, Road No. 36
  coords: { lat: 17.4308, lng: 78.4071 },
};

export const NAV = [
  { href: "/menu/", label: "Menu" },
  { href: "/#experience", label: "Experience" },
  { href: "/#chaimate", label: "ChAimate" },
  { href: "/story/", label: "Our Story" },
  { href: "/gallery/", label: "Gallery" },
  { href: "/reservations/", label: "Reservations" },
];

export type Signature = { name: string; photo: string; description: string; price: number; origin: string; notes: string[] };
export const SIGNATURES: Signature[] = [
  { name: "Hyderabad Cold Brew", photo: "iced-coffee", price: 340, origin: "Chikmagalur · Baba Budangiri",
    description: "Steeped for eighteen hours, finished with a whisper of rose and jaggery.", notes: ["Cocoa", "Dried rose", "Long finish"] },
  { name: "Cardamom Flat White", photo: "latte-hands", price: 320, origin: "Coorg · Kerehaklu Estate",
    description: "Double ristretto, silky milk, green cardamom ground to order.", notes: ["Cardamom", "Caramel", "Velvet"] },
  { name: "Deccan Mocha", photo: "latte-pour", price: 360, origin: "Araku Valley · Single origin",
    description: "Araku espresso with 70% Indian dark chocolate and a pinch of sea salt.", notes: ["Dark chocolate", "Salt", "Stone fruit"] },
  { name: "Saffron Cappuccino", photo: "pour", price: 380, origin: "Nilgiris · Honey process",
    description: "Kashmiri saffron bloomed in warm milk, poured over a bright honey-process shot.", notes: ["Saffron", "Honey", "Floral"] },
];

export type MenuItem = { name: string; description: string; ingredients: string; price: number; diet: ("V" | "VG" | "GF" | "N" | "E")[]; note?: string };
export type MenuCategory = { id: string; title: string; intro: string; photo: string; items: MenuItem[] };
export const DIET_LABELS: Record<string, string> = { V: "Vegetarian", VG: "Vegan", GF: "Gluten-free", N: "Contains nuts", E: "Contains egg" };

export const MENU: MenuCategory[] = [
  { id: "coffee", title: "Coffee", intro: "Indian single-estate beans, roasted in small batches every Monday.", photo: "espresso", items: [
    { name: "Espresso", description: "Our house blend — Araku and Coorg.", ingredients: "Double shot · 36 g", price: 220, diet: ["VG", "GF"] },
    { name: "Cortado", description: "Equal parts espresso and warm milk.", ingredients: "Double shot · steamed milk", price: 260, diet: ["V", "GF"] },
    { name: "Cardamom Cloud", description: "Our signature, softly spiced.", ingredients: "Double espresso · steamed milk · green cardamom · jaggery", price: 320, diet: ["V", "GF"] },
    { name: "Pour Over", description: "Rotating single origin, brewed by hand.", ingredients: "V60 · 250 ml · ask for today's bean", price: 340, diet: ["VG", "GF"] },
    { name: "Filter Kaapi, Reimagined", description: "South Indian decoction, slow-dripped, pulled with jaggery milk.", ingredients: "Chicory blend · jaggery · brass davara", price: 240, diet: ["V", "GF"] },
    { name: "Oat Flat White", description: "Double ristretto, oat milk.", ingredients: "Double ristretto · oat milk", price: 340, diet: ["VG"] },
  ]},
  { id: "signature", title: "Signature Drinks", intro: "Recipes you will only find here.", photo: "iced-latte", items: [
    { name: "Hyderabad Cold Brew", description: "Eighteen-hour steep, rose and jaggery.", ingredients: "Cold brew · rose · jaggery · ice", price: 340, diet: ["VG", "GF"] },
    { name: "Saffron Cappuccino", description: "Kashmiri saffron, honey-process shot.", ingredients: "Espresso · saffron milk · honey", price: 380, diet: ["V", "GF"] },
    { name: "Deccan Mocha", description: "Araku espresso, Indian 70% chocolate, sea salt.", ingredients: "Espresso · dark chocolate · milk · salt", price: 360, diet: ["V", "GF"] },
    { name: "Irani Chai Royale", description: "The city's classic, slow-simmered for two hours.", ingredients: "Assam CTC · khoya · cardamom", price: 220, diet: ["V", "GF"] },
    { name: "Sulaimani Tonic", description: "Spiced black tea, tonic, lime and mint.", ingredients: "Sulaimani · tonic · lime · mint", price: 290, diet: ["VG", "GF"] },
  ]},
  { id: "breakfast", title: "Breakfast", intro: "Served until noon. Slow mornings encouraged.", photo: "brunch", items: [
    { name: "Deccan Shakshuka", description: "Eggs baked in a smoky tomato–chilli sauce.", ingredients: "Farm eggs · tomato · kashmiri chilli · sourdough", price: 520, diet: ["V", "E"] },
    { name: "Avocado, Podi & Sourdough", description: "Crushed avocado with gunpowder podi.", ingredients: "Sourdough · avocado · podi · lime · radish", price: 560, diet: ["VG"] },
    { name: "Bun Maska Brioche", description: "The Irani café classic, made with our brioche.", ingredients: "House brioche · cultured butter · sea salt", price: 280, diet: ["V", "E"] },
    { name: "Masala Omelette", description: "Fluffy, green-chilli-flecked, with toast.", ingredients: "Three eggs · onion · coriander · chilli", price: 420, diet: ["V", "E", "GF"] },
  ]},
  { id: "small-plates", title: "Small Plates", intro: "For the table, and for lingering.", photo: "plating", items: [
    { name: "Lukhmi, Modern", description: "Hyderabad's square pastry with slow-cooked lamb.", ingredients: "Lamb keema · puff pastry · mint chutney", price: 480, diet: [] },
    { name: "Charred Corn Chaat", description: "Smoky corn, tamarind and crisp sev.", ingredients: "Corn · tamarind · sev · pomegranate", price: 390, diet: ["V"] },
    { name: "Paneer Tikka Bao", description: "Pillowy bao, charred paneer, pickled onion.", ingredients: "Bao · paneer · pickled onion · coriander", price: 460, diet: ["V"] },
    { name: "Chicken 65 Bites", description: "The Hyderabad original, crisp and curry-leafed.", ingredients: "Chicken · curry leaf · chilli · yoghurt dip", price: 520, diet: ["GF"] },
  ]},
  { id: "desserts", title: "Desserts", intro: "Made in-house each afternoon.", photo: "dessert", items: [
    { name: "Qubani Tart", description: "Hyderabadi apricot compote in a butter tart.", ingredients: "Apricot · almond frangipane · malai", price: 420, diet: ["V", "N", "E"] },
    { name: "Double ka Meetha, Reimagined", description: "Brioche pudding, saffron custard, pistachio.", ingredients: "Brioche · saffron · pistachio", price: 390, diet: ["V", "N", "E"] },
    { name: "Dark Chocolate Pot", description: "70% Indian chocolate, sea salt, olive oil.", ingredients: "Chocolate · cream · sea salt", price: 360, diet: ["V", "GF"] },
    { name: "Pain au Chocolat", description: "Laminated for three days.", ingredients: "Butter · flour · dark chocolate", price: 260, diet: ["V", "E"] },
  ]},
  { id: "seasonal", title: "Seasonal Specials", intro: "Monsoon menu — changes with the rain.", photo: "pastry-rose", items: [
    { name: "Rose & Cardamom Cruffin", description: "Croissant dough, rose cream, dried petals.", ingredients: "Laminated dough · rose · cardamom", price: 320, diet: ["V", "E"], note: "Weekends only" },
    { name: "Mango Cold Foam Brew", description: "Last of the season's Alphonso.", ingredients: "Cold brew · mango foam", price: 380, diet: ["V", "GF"] },
    { name: "Haleem Toast", description: "A Ramzan favourite, on sourdough.", ingredients: "Slow-cooked lamb haleem · sourdough · fried onion", price: 540, diet: [], note: "Limited" },
  ]},
];

export const SPACES = [
  { id: "bar", title: "Coffee Bar", text: "A twelve-seat walnut counter facing the roaster. Watch every shot pulled." },
  { id: "private", title: "Private Dining", text: "A candle-lit room for ten beneath a hand-carved jaali screen." },
  { id: "outdoor", title: "Outdoor Seating", text: "A neem-shaded courtyard, lit by brass lanterns after sunset." },
  { id: "bakery", title: "Bakery", text: "Laminated pastries from 6 AM — brioche, cruffins, the Qubani tart." },
  { id: "lounge", title: "Work Lounge", text: "Quiet corner sofas, fast Wi-Fi and a refill policy we are proud of." },
];

export const EVENTS = [
  { title: "Private Dinners", text: "Tasting menus for up to ten, in our private room." },
  { title: "Corporate Meetings", text: "Breakfast briefings and offsites with specialty coffee on tap." },
  { title: "Birthday Celebrations", text: "A cake from our pastry kitchen, candles and the courtyard." },
  { title: "Date Nights", text: "A corner table, a slow dinner, a nightcap coffee." },
  { title: "Brand Events", text: "Launches and editorial shoots, with full buy-out of the house." },
  { title: "Small Gatherings", text: "Book clubs, reunions and Sunday brunches for twelve." },
];

export const TESTIMONIALS = [
  { quote: "The kind of place where one coffee turns into three hours.", who: "Ananya R.", where: "Banjara Hills" },
  { quote: "Their cardamom flat white ruined every other café in the city for me.", who: "Karthik M.", where: "Gachibowli" },
  { quote: "It feels like Hyderabad — generous, unhurried, and quietly grand.", who: "Zoya H.", where: "Old City" },
  { quote: "We came for a meeting and stayed for dinner. Twice this month.", who: "Rohan & Meera", where: "Financial District" },
];

export const GALLERY = [
  { photo: "interior", alt: "The main room in warm afternoon light", tag: "Interior" },
  { photo: "latte-pour", alt: "Milk being poured into an espresso", tag: "Coffee" },
  { photo: "jaali-light", alt: "Sunlight through a carved stone jaali", tag: "Architecture" },
  { photo: "pain-au-chocolat", alt: "A pain au chocolat on the pass", tag: "Bakery" },
  { photo: "barista", alt: "Our head barista at the machine", tag: "Barista" },
  { photo: "qutb-night", alt: "The Qutb Shahi tombs lit at night", tag: "Night" },
  { photo: "dessert-plate", alt: "A plated chocolate dessert", tag: "Desserts" },
  { photo: "interior-evening", alt: "The café in the evening", tag: "Night ambience" },
  { photo: "brunch", alt: "A slow brunch at the corner table", tag: "Food" },
  { photo: "chowmahalla-door", alt: "A carved Deccan doorway", tag: "Architecture" },
  { photo: "beans", alt: "Freshly roasted coffee beans", tag: "Coffee" },
  { photo: "terrace", alt: "The courtyard under the pergola", tag: "Outdoor" },
];
