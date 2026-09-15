// Color families are NAVIGATION colour only: they help you recognise a region
// of the world. They are chosen from what the ingredient looks like and say
// nothing about how it tastes or what it pairs with.
export const FAMILIES = {
  emerald: {label: 'Emerald green', hex: '#3fae6a', deep: '#0f3d26'},
  crimson: {label: 'Crimson red',   hex: '#d9433f', deep: '#4a1210'},
  orange:  {label: 'Orange',        hex: '#ea8a2c', deep: '#4d2a0a'},
  gold:    {label: 'Golden yellow', hex: '#e6c34a', deep: '#4d3f0e'},
  violet:  {label: 'Violet',        hex: '#8f5fd1', deep: '#2c1650'},
  blue:    {label: 'Deep blue',     hex: '#4a7fd6', deep: '#122448'},
  ivory:   {label: 'Pearl / ivory', hex: '#efe6cf', deep: '#4a4636'},
  copper:  {label: 'Copper / earth',hex: '#b8733c', deep: '#3d2412'},
  mist:    {label: 'Mist',          hex: '#8fb5a3', deep: '#213a30'},
};

// Ordered: first matching rule wins. Patterns test the lowercase label.
const RULES = [
  ['blue',    /\b(blueberr|blue cheese|borage|juniper|blackcurrant|black currant|acai|açai|elderberr|damson|sloe)/],
  ['violet',  /\b(eggplant|aubergine|purple|grape|plum|fig|blackberr|lavender|beet|beetroot|radicchio|red cabbage|red onion|mulberr|boysenberr|prune|raisin|currant|passion|taro|ube|shiso|violet)/],
  ['crimson', /\b(tomato|pomodoro|red pepper|red bell|chile|chili|chilli|cayenne|paprika|saffron|strawberr|raspberr|cherr|cranberr|pomegranate|rhubarb|watermelon|radish|red wine|lobster|crab|shrimp|prawn|salmon|tuna|beef|steak|lamb|venison|duck|bacon|ham|chorizo|sausage|pepperoni|salami|prosciutto|harissa|gochujang|sriracha|ketchup|hibiscus|rose|sumac|pimient|goji|lingonberr)/],
  ['orange',  /\b(carrot|pumpkin|squash|orange|apricot|peach|nectarine|mango|papaya|persimmon|tangerine|clementine|mandarin|kumquat|cantaloupe|sweet potato|yam|turmeric|annatto|habanero|kabocha|butternut|marmalade|salmon roe|sea urchin|uni|smoked paprika|curry)/],
  ['gold',    /\b(lemon|corn|banana|pineapple|honey|butter|egg|yolk|mustard|ginger|golden|yellow|polenta|cornmeal|chickpea|garbanzo|lentil|mango|quince|pear|apple|melon|honeydew|maple|caramel|custard|cheddar|gouda|parmesan|parmigiano|olive oil|ghee|saffron|chamomile|elderflower|vanilla|sesame|tahini|peanut|cashew|almond|macadamia|pine nut|brioche|croissant|beer|ale|cider|white wine|champagne|sherry|bourbon|whisk|rum|brandy|cognac|tequila|mezcal)/],
  ['copper',  /\b(mushroom|porcini|shiitake|morel|chanterelle|truffle|cocoa|cacao|chocolate|coffee|espresso|cinnamon|nutmeg|clove|allspice|walnut|pecan|hazelnut|chestnut|brown|toast|bread|rye|barley|wheat|oat|buckwheat|farro|spelt|quinoa|miso|soy|tamari|molasses|brown sugar|date|tamarind|caramel|coriander seed|cumin|cardamom|anise|fennel seed|caraway|nigella|pork|chicken|turkey|veal|liver|anchov|sardine|mackerel|oyster|clam|mussel|scallop|squid|octopus|tea|stout|porter|balsamic|worcestershire|vinegar|smoke|smoked|bbq|barbecue|pretzel|pastrami|jerk|mole|garam|five-spice|star anise|mace|juniper|hoisin|black bean|adzuki|kidney bean|pinto|black-eyed)/],
  ['ivory',   /\b(garlic|cauliflower|cream|milk|yogurt|yoghurt|rice|coconut|onion|shallot|leek|potato|parsnip|turnip|celery root|celeriac|jicama|daikon|white|cheese|mozzarella|ricotta|feta|goat cheese|brie|mascarpone|burrata|tofu|bean|cannellini|navy bean|lima|fava|edamame|noodle|pasta|couscous|orzo|dumpling|bread|flour|sugar|salt|pepper|vanilla|almond|pine nut|macadamia|cashew|sesame|sesame seed|horseradish|wasabi|ginger|lychee|pear|jicama|water chestnut|bamboo|hearts of palm|artichoke|endive|fennel|cabbage|bok choy|napa|kohlrabi|scallion|chive|egg white|meringue|mayonnaise|aioli|crème|creme|sour cream|buttermilk|kefir|whey|halloumi|paneer|queso|pecorino|gruy|comt|emmental|swiss|jack|provolone|fontina|taleggio|raclette|camembert|chèvre|chevre)/],
  ['gold',    /\b(oil|nectar|syrup|asafoetida|hing|mustard seed|fenugreek|chickpea flour|besan|ghee|corn|polenta|grits|hominy|plantain|starfruit|loquat|physalis|cape gooseberr|mirabelle|durian|jackfruit|lemon verbena|bee pollen|royal jelly|saffron)/],
  ['ivory',   /\b(bass|bluefish|cod|halibut|sole|flounder|snapper|trout|haddock|tilapia|catfish|monkfish|grouper|mahi|swordfish|branzino|perch|pike|carp|eel|skate|turbot|hake|whitefish|pollock|scrod|fish|calamari|cuttlefish|frog|rabbit|quail|pheasant|goose|capon|hen|poultry|milk|cream|panna|semolina|tapioca|sago|arrowroot|kudzu|matzo|tortilla|pita|naan|noodle|rice|congee|risotto|udon|soba|ramen|rice paper|rice noodle|vermicelli|lotus seed|water chestnut|jicama|palm heart|salsify|sunchoke|jerusalem artichoke|celery root|celeriac|kohlrabi|rutabaga|turnip|parsnip|daikon|radish, white|white bean|great northern|butter bean|lima|gigante|tofu|tempeh|seitan|yuba|paneer|labneh|skyr|quark|fromage|crème fraîche|creme fraiche|clotted|condensed milk|evaporated milk|almond milk|oat milk|soy milk|coconut milk|coconut cream|coconut water|cauliflower|garlic|onion|shallot|leek|scallion)/],
  ['copper',  /\b(burdock|gobo|lotus root|caviar|roe|bottarga|katsuobushi|bonito|dashi|fish sauce|shrimp paste|belacan|oyster sauce|xo sauce|black garlic|black vinegar|tamarind|carob|malt|molasses|treacle|sorghum|jaggery|piloncillo|panela|muscovado|demerara|turbinado|chicory|dandelion root|burnt|charred|grilled|roasted|smoked|liquid smoke|lapsang|pu-erh|rooibos|yerba|mate|guarana|kola|cola|root beer|sarsaparilla|sassafras|birch|maple)/],
  ['emerald', /\b(arame|hijiki|agar|kanten|kelp|dulse|laver|angelica|borage|chervil|lemon balm|bergamot|sweet cicely|hyssop|wood sorrel|nasturtium|chickweed|lamb's quarter|amaranth leaves|water spinach|morning glory|sweet potato leaves|chrysanthemum|garland|pea shoot|bean sprout|sprout|microgreen|cabbage, green|cabbage, savoy|savoy|brussels|broccolini|rapini|gai lan|choy sum|celtuce|romanesco|basil|spinach|zucchini|courgette|kale|chard|arugula|rocket|lettuce|romaine|watercress|cress|parsley|cilantro|coriander|mint|dill|tarragon|chervil|sorrel|lovage|oregano|marjoram|thyme|rosemary|sage|bay|lemongrass|kaffir|lime|avocado|cucumber|celery|asparagus|broccoli|brussels|green bean|haricot|snap pea|snow pea|pea|okra|green|herb|pesto|nori|seaweed|kelp|wakame|kombu|dulse|spirulina|matcha|pistachio|olive|caper|jalape|serrano|poblano|tomatillo|edamame|fava|artichoke|leek|scallion|chive|ramp|garlic scape|nettle|dandelion|purslane|mizuna|tatsoi|bok choy|collard|mustard green|turnip green|beet green|fiddlehead|samphire|sea bean|wheatgrass|kiwi|honeydew|green apple|gooseberr|verbena|hyssop|savory|epazote|hoja santa|curry leaf|pandan|makrut|absinthe|chartreuse|gin|vermouth|sauvignon|grüner|gruner)/],
];

export function familyFor(label) {
  const s = (label || '').toLowerCase();
  for (const [family, re] of RULES) if (re.test(s)) return family;
  return 'mist';
}
