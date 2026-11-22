/**
 * Compact emoji + Unicode symbol dataset for the Emoji & Unicode picker.
 * Format: `#category` or `#category:group` header lines, then `glyph|name|keywords` rows.
 * A name starting with `~` marks an emoji that accepts a skin-tone modifier.
 * Flags are generated from ISO country codes (regional indicator pairs) to keep the file small.
 */

export interface EmojiItem {
    char: string;
    name: string;
    keywords: string;
    category: string;
    group?: string;
    tone?: boolean;
}

const RAW = `#smileys
😀|grinning face|smile happy joy
😃|grinning face with big eyes|smile happy
😄|grinning face with smiling eyes|smile happy laugh
😁|beaming face with smiling eyes|grin teeth
😆|grinning squinting face|laugh lol
😅|grinning face with sweat|relief nervous phew
🤣|rolling on the floor laughing|rofl lol
😂|face with tears of joy|lol laugh crying
🙂|slightly smiling face|smile ok
🙃|upside-down face|sarcasm silly
🫠|melting face|melt embarrassed heat
😉|winking face|wink flirt
😊|smiling face with smiling eyes|blush happy
😇|smiling face with halo|angel innocent
🥰|smiling face with hearts|love adore crush
😍|smiling face with heart-eyes|love crush
🤩|star-struck|wow amazed starry
😘|face blowing a kiss|kiss love
😗|kissing face|kiss
☺️|smiling face|relaxed happy
😚|kissing face with closed eyes|kiss
😙|kissing face with smiling eyes|kiss
🥲|smiling face with tear|grateful touched
😋|face savoring food|yum delicious
😛|face with tongue|tongue playful
😜|winking face with tongue|crazy joke
🤪|zany face|crazy goofy wild
😝|squinting face with tongue|tongue silly
🤑|money-mouth face|money rich dollar
🤗|smiling face with open hands|hug
🤭|face with hand over mouth|oops giggle
🫢|face with open eyes and hand over mouth|shock gasp
🫣|face with peeking eye|peek scared
🤫|shushing face|quiet secret shh
🤔|thinking face|think hmm consider
🫡|saluting face|salute respect yes
🤐|zipper-mouth face|secret quiet
🤨|face with raised eyebrow|skeptic doubt
😐|neutral face|meh blank
😑|expressionless face|blank unamused
😶|face without mouth|silent speechless
🫥|dotted line face|invisible hidden
😶‍🌫️|face in clouds|fog confused
😏|smirking face|smirk sly
😒|unamused face|meh annoyed
🙄|face with rolling eyes|eyeroll whatever
😬|grimacing face|awkward eek
😮‍💨|face exhaling|sigh relief
🤥|lying face|liar pinocchio
🫨|shaking face|shock earthquake
😌|relieved face|calm content
😔|pensive face|sad thoughtful
😪|sleepy face|tired
🤤|drooling face|drool want
😴|sleeping face|sleep zzz tired
😷|face with medical mask|sick mask covid
🤒|face with thermometer|sick fever ill
🤕|face with head-bandage|hurt injured
🤢|nauseated face|sick gross
🤮|face vomiting|sick puke
🤧|sneezing face|sneeze cold flu
🥵|hot face|heat sweat
🥶|cold face|freezing ice
🥴|woozy face|drunk dizzy
😵|face with crossed-out eyes|dizzy dead
😵‍💫|face with spiral eyes|dizzy hypnotized
🤯|exploding head|mind blown shock
🤠|cowboy hat face|cowboy
🥳|partying face|party celebrate birthday
🥸|disguised face|disguise incognito
😎|smiling face with sunglasses|cool sunglasses
🤓|nerd face|nerd geek glasses
🧐|face with monocle|inspect fancy
😕|confused face|confused unsure
🫤|face with diagonal mouth|meh skeptical
😟|worried face|worry concern
🙁|slightly frowning face|sad
☹️|frowning face|sad
😮|face with open mouth|wow surprised
😯|hushed face|surprised
😲|astonished face|shocked amazed
😳|flushed face|embarrassed blush
🥺|pleading face|please puppy eyes
🥹|face holding back tears|touched grateful
😦|frowning face with open mouth|shock
😧|anguished face|pain
😨|fearful face|scared fear
😰|anxious face with sweat|nervous anxious
😥|sad but relieved face|phew sad
😢|crying face|sad tear
😭|loudly crying face|sob cry sad
😱|face screaming in fear|scream horror
😖|confounded face|frustrated
😣|persevering face|struggle
😞|disappointed face|sad
😓|downcast face with sweat|hard work
😩|weary face|tired frustrated
😫|tired face|exhausted
🥱|yawning face|bored tired yawn
😤|face with steam from nose|triumph angry huff
😡|enraged face|angry mad rage
😠|angry face|mad annoyed
🤬|face with symbols on mouth|swear curse angry
😈|smiling face with horns|devil evil
👿|angry face with horns|devil imp
💀|skull|dead death dying laughing
☠️|skull and crossbones|danger poison pirate
💩|pile of poo|poop
🤡|clown face|clown
👹|ogre|monster
👺|goblin|monster
👻|ghost|halloween boo
👽|alien|ufo extraterrestrial
👾|alien monster|game space invader
🤖|robot|bot ai machine
😺|grinning cat|cat smile
😸|grinning cat with smiling eyes|cat
😹|cat with tears of joy|cat laugh
😻|smiling cat with heart-eyes|cat love
😼|cat with wry smile|cat smirk
😽|kissing cat|cat kiss
🙀|weary cat|cat shock
😿|crying cat|cat sad
😾|pouting cat|cat angry
🙈|see-no-evil monkey|monkey hide shy
🙉|hear-no-evil monkey|monkey
🙊|speak-no-evil monkey|monkey oops
💋|kiss mark|kiss lips
💌|love letter|mail love
💘|heart with arrow|love cupid
💝|heart with ribbon|gift love
💖|sparkling heart|love
💗|growing heart|love
💓|beating heart|love heartbeat
💞|revolving hearts|love
💕|two hearts|love
💟|heart decoration|love
❣️|heart exclamation|love
💔|broken heart|sad breakup
❤️‍🔥|heart on fire|passion love
❤️‍🩹|mending heart|healing recovery
❤️|red heart|love like
🩷|pink heart|love
🧡|orange heart|love
💛|yellow heart|love
💚|green heart|love
💙|blue heart|love
🩵|light blue heart|love
💜|purple heart|love
🤎|brown heart|love
🖤|black heart|love dark
🩶|grey heart|love
🤍|white heart|love
💯|hundred points|100 perfect score
💢|anger symbol|angry
💥|collision|boom explosion bang
💫|dizzy|star
💦|sweat droplets|water splash
💨|dashing away|fast wind
🕳️|hole|hole
💬|speech balloon|chat comment message
👁️‍🗨️|eye in speech bubble|witness
🗨️|left speech bubble|chat
🗯️|right anger bubble|angry
💭|thought balloon|think
💤|zzz|sleep
#people
👋|~waving hand|hello hi bye wave
🤚|~raised back of hand|stop
🖐️|~hand with fingers splayed|hand five
✋|~raised hand|stop high five
🖖|~vulcan salute|spock star trek
🫱|~rightwards hand|hand
🫲|~leftwards hand|hand
🫳|~palm down hand|drop
🫴|~palm up hand|offer
👌|~ok hand|ok perfect
🤌|~pinched fingers|italian
🤏|~pinching hand|small tiny
✌️|~victory hand|peace
🤞|~crossed fingers|luck hope
🫰|~hand with index finger and thumb crossed|money heart
🤟|~love-you gesture|love
🤘|~sign of the horns|rock metal
🤙|~call me hand|call shaka
👈|~backhand index pointing left|left
👉|~backhand index pointing right|right
👆|~backhand index pointing up|up
🖕|~middle finger|rude
👇|~backhand index pointing down|down
☝️|~index pointing up|up one
🫵|~index pointing at the viewer|you
👍|~thumbs up|like yes approve +1
👎|~thumbs down|dislike no -1
✊|~raised fist|power solidarity
👊|~oncoming fist|punch bump
🤛|~left-facing fist|bump
🤜|~right-facing fist|bump
👏|~clapping hands|clap applause bravo
🙌|~raising hands|hooray celebrate
🫶|~heart hands|love
👐|~open hands|hug
🤲|~palms up together|pray dua
🤝|handshake|deal agreement
🙏|~folded hands|please thanks pray
✍️|~writing hand|write
💅|~nail polish|nails beauty
🤳|~selfie|camera phone
💪|~flexed biceps|strong muscle gym
🦾|mechanical arm|prosthetic robot
🦵|~leg|kick
🦶|~foot|kick
👂|~ear|hear listen
👃|~nose|smell
🧠|brain|smart mind think
🫀|anatomical heart|heart organ
🫁|lungs|breath
🦷|tooth|dentist
🦴|bone|skeleton
👀|eyes|look see watch
👁️|eye|look see
👅|tongue|lick
👄|mouth|lips
🫦|biting lip|nervous flirt
👶|~baby|child newborn
🧒|~child|kid
👦|~boy|child
👧|~girl|child
🧑|~person|adult
👱|~person blond hair|blond
👨|~man|male
🧔|~person beard|beard
👩|~woman|female
🧓|~older person|elderly
👴|~old man|grandpa elderly
👵|~old woman|grandma elderly
🙍|~person frowning|sad
🙎|~person pouting|upset
🙅|~person gesturing no|no stop
🙆|~person gesturing ok|ok yes
💁|~person tipping hand|info sassy
🙋|~person raising hand|question hi
🧏|~deaf person|deaf
🙇|~person bowing|sorry respect
🤦|~person facepalming|facepalm ugh
🤷|~person shrugging|shrug dunno whatever
🧑‍⚕️|~health worker|doctor nurse
🧑‍🎓|~student|graduate school
🧑‍🏫|~teacher|professor
🧑‍⚖️|~judge|law justice
🧑‍🌾|~farmer|agriculture
🧑‍🍳|~cook|chef
🧑‍🔧|~mechanic|repair
🧑‍🏭|~factory worker|industry
🧑‍💼|~office worker|business
🧑‍🔬|~scientist|lab research
🧑‍💻|~technologist|developer programmer coder
👨‍💻|~man technologist|developer programmer
👩‍💻|~woman technologist|developer programmer
🧑‍🎤|~singer|music
🧑‍🎨|~artist|painter
🧑‍✈️|~pilot|plane
🧑‍🚀|~astronaut|space
🧑‍🚒|~firefighter|fire
👮|~police officer|police cop
🕵️|~detective|spy sleuth
💂|~guard|guard
🥷|~ninja|stealth
👷|~construction worker|builder
🫅|~person with crown|royal king
🤴|~prince|royal
👸|~princess|royal
👳|~person wearing turban|turban
👲|~person with skullcap|cap
🧕|~woman with headscarf|hijab
🤵|~person in tuxedo|groom formal
👰|~person with veil|bride wedding
🤰|~pregnant woman|pregnant
🤱|~breast-feeding|baby
👼|~baby angel|angel
🎅|~santa claus|christmas
🤶|~mrs claus|christmas
🦸|~superhero|hero
🦹|~supervillain|villain
🧙|~mage|wizard witch
🧚|~fairy|magic
🧛|~vampire|dracula
🧜|~merperson|mermaid
🧝|~elf|fantasy
🧞|genie|magic wish
🧟|zombie|undead
🧌|troll|fantasy
💆|~person getting massage|spa relax
💇|~person getting haircut|barber
🚶|~person walking|walk
🧍|~person standing|stand
🧎|~person kneeling|kneel
🏃|~person running|run exercise
💃|~woman dancing|dance
🕺|~man dancing|dance disco
🕴️|~person in suit levitating|business
👯|people with bunny ears|dance party
🧖|~person in steamy room|sauna
🧗|~person climbing|climb
🧘|~person in lotus position|yoga meditate
🛀|~person taking bath|bath
🛌|~person in bed|sleep
🧑‍🤝‍🧑|people holding hands|friends couple
👫|woman and man holding hands|couple
💏|kiss|couple love
💑|couple with heart|love
👪|family|parents children
🗣️|speaking head|talk speak
👤|bust in silhouette|user profile avatar
👥|busts in silhouette|users group team
🫂|people hugging|hug comfort
👣|footprints|steps
#nature
🐶|dog face|dog puppy pet
🐱|cat face|cat kitten pet
🐭|mouse face|mouse
🐹|hamster|pet
🐰|rabbit face|bunny
🦊|fox|fox
🐻|bear|bear
🐼|panda|panda
🐻‍❄️|polar bear|arctic
🐨|koala|koala
🐯|tiger face|tiger bengal
🦁|lion|lion king
🐮|cow face|cow
🐷|pig face|pig
🐸|frog|frog
🐵|monkey face|monkey
🐔|chicken|hen
🐧|penguin|penguin linux
🐦|bird|bird twitter
🐤|baby chick|chick
🦆|duck|duck
🦅|eagle|eagle
🦉|owl|owl night
🦇|bat|bat
🐺|wolf|wolf
🐗|boar|pig
🐴|horse face|horse
🦄|unicorn|unicorn magic startup
🐝|honeybee|bee
🪱|worm|worm
🐛|bug|bug insect caterpillar
🦋|butterfly|butterfly
🐌|snail|slow
🐞|lady beetle|ladybug bug
🐜|ant|ant
🪲|beetle|bug
🦟|mosquito|dengue malaria
🪳|cockroach|bug
🕷️|spider|spider
🕸️|spider web|web
🦂|scorpion|scorpion
🐢|turtle|slow
🐍|snake|python serpent
🦎|lizard|reptile
🦖|t-rex|dinosaur
🦕|sauropod|dinosaur
🐙|octopus|octopus github
🦑|squid|squid
🦐|shrimp|prawn chingri
🦞|lobster|lobster
🦀|crab|crab rust
🐡|blowfish|fish
🐠|tropical fish|fish
🐟|fish|fish hilsa
🐬|dolphin|dolphin
🐳|spouting whale|whale docker
🐋|whale|whale
🦈|shark|shark
🐊|crocodile|crocodile
🐅|tiger|tiger royal bengal
🐆|leopard|leopard
🦓|zebra|zebra
🦍|gorilla|gorilla
🐘|elephant|elephant php
🦛|hippopotamus|hippo
🦏|rhinoceros|rhino
🐪|camel|camel
🦒|giraffe|giraffe
🦘|kangaroo|kangaroo
🐃|water buffalo|buffalo
🐂|ox|ox
🐄|cow|cow
🐎|horse|horse
🐖|pig|pig
🐑|ewe|sheep
🐐|goat|goat
🦌|deer|deer
🐕|dog|dog
🐈|cat|cat
🐈‍⬛|black cat|cat
🐓|rooster|rooster
🦃|turkey|turkey
🦚|peacock|peacock
🦜|parrot|parrot
🦢|swan|swan
🕊️|dove|peace
🐇|rabbit|rabbit
🦝|raccoon|raccoon
🦨|skunk|skunk
🦦|otter|otter
🦥|sloth|slow lazy
🐁|mouse|mouse
🐀|rat|rat
🐿️|chipmunk|squirrel
🦔|hedgehog|hedgehog
🐾|paw prints|paw
🐉|dragon|dragon
🌵|cactus|desert
🎄|christmas tree|christmas
🌲|evergreen tree|tree
🌳|deciduous tree|tree
🌴|palm tree|palm
🪵|wood|log
🌱|seedling|plant grow
🌿|herb|leaf
☘️|shamrock|clover
🍀|four leaf clover|luck
🎍|pine decoration|bamboo
🪴|potted plant|plant
🍃|leaf fluttering in wind|leaf
🍂|fallen leaf|autumn
🍁|maple leaf|canada autumn
🍄|mushroom|mushroom
🌾|sheaf of rice|rice paddy harvest
💐|bouquet|flowers
🌷|tulip|flower
🌹|rose|flower love
🥀|wilted flower|sad
🪷|lotus|flower shapla
🌺|hibiscus|flower
🌸|cherry blossom|flower spring
🌼|blossom|flower
🌻|sunflower|flower
🌞|sun with face|sun
🌝|full moon face|moon
🌛|first quarter moon face|moon
🌚|new moon face|moon
🌕|full moon|moon
🌙|crescent moon|moon night eid ramadan
🌎|globe showing americas|earth world
🌍|globe showing europe-africa|earth world
🌏|globe showing asia-australia|earth world
🪐|ringed planet|saturn planet
💫|dizzy star|star
⭐|star|star favorite
🌟|glowing star|star
✨|sparkles|sparkle shiny magic new
⚡|high voltage|lightning electric zap
☄️|comet|space
💥|collision|boom
🔥|fire|fire hot lit
🌪️|tornado|storm
🌈|rainbow|rainbow pride
☀️|sun|sunny weather
🌤️|sun behind small cloud|weather
⛅|sun behind cloud|weather
🌥️|sun behind large cloud|weather
☁️|cloud|weather cloud
🌦️|sun behind rain cloud|weather
🌧️|cloud with rain|rain weather
⛈️|cloud with lightning and rain|storm
🌩️|cloud with lightning|storm
🌨️|cloud with snow|snow
❄️|snowflake|snow cold
☃️|snowman|snow
⛄|snowman without snow|snow
🌬️|wind face|wind
💨|dash|wind
💧|droplet|water drop
💦|splashing sweat|water
🌊|water wave|wave ocean sea
🌫️|fog|fog mist
#food
🍏|green apple|apple fruit
🍎|red apple|apple fruit
🍐|pear|fruit
🍊|tangerine|orange fruit
🍋|lemon|fruit
🍌|banana|fruit kola
🍉|watermelon|fruit
🍇|grapes|fruit
🍓|strawberry|fruit
🫐|blueberries|fruit
🍈|melon|fruit
🍒|cherries|fruit
🍑|peach|fruit
🥭|mango|fruit aam
🍍|pineapple|fruit
🥥|coconut|fruit
🥝|kiwi fruit|fruit
🍅|tomato|vegetable
🍆|eggplant|aubergine brinjal begun
🥑|avocado|fruit
🫛|pea pod|vegetable
🥦|broccoli|vegetable
🥬|leafy green|vegetable spinach
🥒|cucumber|vegetable
🌶️|hot pepper|chili spicy morich
🫑|bell pepper|capsicum
🌽|ear of corn|corn
🥕|carrot|vegetable
🫒|olive|olive
🧄|garlic|garlic
🧅|onion|onion peyaj
🥔|potato|potato alu
🍠|roasted sweet potato|potato
🫚|ginger root|ginger
🥐|croissant|bread
🥯|bagel|bread
🍞|bread|bread toast
🥖|baguette bread|bread
🥨|pretzel|snack
🧀|cheese wedge|cheese
🥚|egg|egg
🍳|cooking|egg fry pan
🧈|butter|butter
🥞|pancakes|breakfast
🧇|waffle|breakfast
🥓|bacon|breakfast
🥩|cut of meat|steak meat
🍗|poultry leg|chicken
🍖|meat on bone|meat
🌭|hot dog|food
🍔|hamburger|burger
🍟|french fries|fries chips
🍕|pizza|pizza
🫓|flatbread|naan roti paratha
🥪|sandwich|food
🌮|taco|mexican
🌯|burrito|mexican wrap
🥙|stuffed flatbread|kebab shawarma
🧆|falafel|food
🥘|shallow pan of food|curry paella
🍲|pot of food|stew curry
🥣|bowl with spoon|cereal soup
🥗|green salad|salad healthy
🍿|popcorn|movie snack
🧂|salt|salt
🥫|canned food|can
🍱|bento box|lunch
🍘|rice cracker|snack
🍙|rice ball|onigiri
🍚|cooked rice|rice bhat
🍛|curry rice|curry biryani bhuna
🍜|steaming bowl|noodles ramen
🍝|spaghetti|pasta
🍣|sushi|sushi
🍤|fried shrimp|tempura
🥟|dumpling|momo
🥠|fortune cookie|cookie
🥡|takeout box|chinese food
🍦|soft ice cream|ice cream
🍧|shaved ice|dessert
🍨|ice cream|dessert
🍩|doughnut|donut
🍪|cookie|cookie biscuit
🎂|birthday cake|cake birthday
🍰|shortcake|cake
🧁|cupcake|cake
🥧|pie|dessert
🍫|chocolate bar|chocolate
🍬|candy|sweet
🍭|lollipop|sweet
🍮|custard|pudding dessert
🍯|honey pot|honey
🍼|baby bottle|milk
🥛|glass of milk|milk
☕|hot beverage|coffee tea cha java
🫖|teapot|tea cha
🍵|teacup without handle|tea green
🧃|beverage box|juice
🥤|cup with straw|soda drink
🧋|bubble tea|boba
🍶|sake|drink
🍺|beer mug|beer
🍻|clinking beer mugs|cheers
🥂|clinking glasses|cheers celebrate
🍷|wine glass|wine
🍸|cocktail glass|cocktail
🍹|tropical drink|cocktail
🧊|ice|ice cube
🥢|chopsticks|chopsticks
🍽️|fork and knife with plate|dinner
🍴|fork and knife|cutlery restaurant
🥄|spoon|spoon
🔪|kitchen knife|knife
#travel
🚗|automobile|car
🚕|taxi|car cab uber
🚙|sport utility vehicle|suv car
🚌|bus|bus
🚎|trolleybus|bus
🏎️|racing car|car race
🚓|police car|police
🚑|ambulance|emergency
🚒|fire engine|fire
🚐|minibus|van
🛻|pickup truck|truck
🚚|delivery truck|truck delivery shipping
🚛|articulated lorry|truck
🚜|tractor|farm
🛵|motor scooter|scooter
🏍️|motorcycle|bike
🛺|auto rickshaw|cng tuk tuk
🚲|bicycle|bike cycle
🛴|kick scooter|scooter
🚨|police car light|siren alert alarm
🚥|horizontal traffic light|traffic
🚦|vertical traffic light|traffic
🛑|stop sign|stop
🚧|construction|wip under construction
⚓|anchor|ship
🛟|ring buoy|lifebuoy
⛵|sailboat|boat
🛶|canoe|boat
🚤|speedboat|boat
🛳️|passenger ship|cruise
⛴️|ferry|launch boat
🚢|ship|ship
✈️|airplane|plane flight
🛫|airplane departure|takeoff
🛬|airplane arrival|landing
🪂|parachute|skydive
💺|seat|seat
🚁|helicopter|helicopter
🚟|suspension railway|train
🚠|mountain cableway|cable car
🚀|rocket|launch deploy ship it
🛸|flying saucer|ufo
🛰️|satellite|space
🚂|locomotive|train steam
🚆|train|train
🚇|metro|subway metro rail
🚉|station|train
🚊|tram|tram
🗺️|world map|map
🧭|compass|navigation
🏔️|snow-capped mountain|mountain
⛰️|mountain|mountain
🌋|volcano|volcano
🏕️|camping|camp
🏖️|beach with umbrella|beach cox's bazar
🏜️|desert|desert
🏝️|desert island|island
🏟️|stadium|stadium
🏛️|classical building|museum
🏗️|building construction|construction
🧱|brick|wall
🏘️|houses|houses
🏠|house|home
🏡|house with garden|home
🏢|office building|office
🏣|japanese post office|post
🏥|hospital|hospital
🏦|bank|bank money
🏨|hotel|hotel
🏪|convenience store|shop
🏫|school|school
🏬|department store|mall
🏭|factory|factory
🏯|japanese castle|castle
🏰|castle|castle
💒|wedding|wedding
🗼|tokyo tower|tower
🗽|statue of liberty|new york
⛪|church|religion
🕌|mosque|masjid islam
🛕|hindu temple|mandir
🕍|synagogue|jewish
🕋|kaaba|mecca islam
⛲|fountain|fountain
⛺|tent|camping
🌁|foggy|fog
🌃|night with stars|night city
🏙️|cityscape|city
🌄|sunrise over mountains|sunrise
🌅|sunrise|sunrise
🌆|cityscape at dusk|city sunset
🌇|sunset|sunset
🌉|bridge at night|bridge padma
🎠|carousel horse|fair
🎡|ferris wheel|fair
🎢|roller coaster|fair
⛽|fuel pump|gas petrol
🛣️|motorway|highway road
🛤️|railway track|rail
⏳|hourglass not done|wait time loading
⌛|hourglass done|time
⌚|watch|time
⏰|alarm clock|alarm time
⏱️|stopwatch|timer
⏲️|timer clock|timer
🕰️|mantelpiece clock|clock
🌐|globe with meridians|web internet www
#activities
🎃|jack-o-lantern|halloween
🎆|fireworks|celebrate new year
🎇|sparkler|celebrate
🧨|firecracker|explosive
🎈|balloon|party birthday
🎉|party popper|party celebrate tada congrats
🎊|confetti ball|party celebrate
🎋|tanabata tree|wish
🎍|pine decoration|new year
🎎|japanese dolls|doll
🎏|carp streamer|flag
🎐|wind chime|chime
🎑|moon viewing ceremony|festival
🧧|red envelope|gift money
🎀|ribbon|gift
🎁|wrapped gift|gift present birthday
🎗️|reminder ribbon|awareness
🎟️|admission tickets|ticket
🎫|ticket|ticket
🎖️|military medal|medal
🏆|trophy|win award champion
🏅|sports medal|medal
🥇|1st place medal|gold first winner
🥈|2nd place medal|silver second
🥉|3rd place medal|bronze third
⚽|soccer ball|football
⚾|baseball|sport
🥎|softball|sport
🏀|basketball|sport
🏐|volleyball|sport
🏈|american football|sport
🏉|rugby football|sport
🎾|tennis|sport
🥏|flying disc|frisbee
🎳|bowling|sport
🏏|cricket game|cricket bat ball tigers
🏑|field hockey|sport
🏒|ice hockey|sport
🥍|lacrosse|sport
🏓|ping pong|table tennis
🏸|badminton|sport
🥊|boxing glove|boxing
🥋|martial arts uniform|karate judo
🥅|goal net|goal
⛳|flag in hole|golf
⛸️|ice skate|skating
🎣|fishing pole|fishing
🤿|diving mask|diving
🎽|running shirt|run
🎿|skis|ski
🛷|sled|sled
🥌|curling stone|curling
🎯|bullseye|target dart goal
🪀|yo-yo|toy
🪁|kite|kite ghuri
🎱|pool 8 ball|billiards
🔮|crystal ball|fortune magic
🪄|magic wand|magic
🎮|video game|game controller gaming
🕹️|joystick|game arcade
🎰|slot machine|casino
🎲|game die|dice random
🧩|puzzle piece|puzzle plugin extension
🧸|teddy bear|toy
🪅|pinata|party
🪩|mirror ball|disco
🪆|nesting dolls|matryoshka
♠️|spade suit|cards
♥️|heart suit|cards
♦️|diamond suit|cards
♣️|club suit|cards
♟️|chess pawn|chess
🃏|joker|cards
🀄|mahjong red dragon|game
🎴|flower playing cards|cards
🎭|performing arts|theater drama
🖼️|framed picture|art
🎨|artist palette|art paint design
🧵|thread|sewing
🧶|yarn|knit
🏋️|~person lifting weights|gym workout
🤸|~person cartwheeling|gymnastics
⛹️|~person bouncing ball|basketball
🤺|person fencing|fencing
🏊|~person swimming|swim
🚴|~person biking|cycling
🧑‍🦯|~person with white cane|blind
#objects
👓|glasses|eyeglasses
🕶️|sunglasses|cool
🥽|goggles|safety
🥼|lab coat|science
🦺|safety vest|safety
👔|necktie|shirt formal
👕|t-shirt|shirt
👖|jeans|pants
🧣|scarf|winter
🧤|gloves|winter
🧥|coat|winter
🧦|socks|socks
👗|dress|dress
👘|kimono|dress
🥻|sari|saree
👙|bikini|swim
👛|purse|wallet
👜|handbag|bag
🎒|backpack|school bag
👞|mans shoe|shoe
👟|running shoe|sneaker
👠|high-heeled shoe|heels
👑|crown|king queen royal
🎩|top hat|hat
🎓|graduation cap|graduate education
🧢|billed cap|cap
💄|lipstick|makeup
💍|ring|wedding engagement
💎|gem stone|diamond jewel ruby
🔇|muted speaker|mute silent
🔊|speaker high volume|loud sound
📢|loudspeaker|announce
📣|megaphone|announce
🔔|bell|notification
🔕|bell with slash|mute notification
🎼|musical score|music
🎵|musical note|music
🎶|musical notes|music
🎙️|studio microphone|podcast mic
🎧|headphone|music audio
📻|radio|radio
🎷|saxophone|music
🎸|guitar|music
🎹|musical keyboard|piano
🎺|trumpet|music
🎻|violin|music
🥁|drum|music
📱|mobile phone|phone smartphone
📲|mobile phone with arrow|call
☎️|telephone|phone
📞|telephone receiver|call phone
📟|pager|pager
📠|fax machine|fax
🔋|battery|battery power
🪫|low battery|battery
🔌|electric plug|plug power
💻|laptop|computer dev code
🖥️|desktop computer|computer monitor
🖨️|printer|print
⌨️|keyboard|keyboard type
🖱️|computer mouse|mouse click
🖲️|trackball|mouse
💽|computer disk|minidisc
💾|floppy disk|save
💿|optical disk|cd
📀|dvd|disc
🧮|abacus|calculate
🎥|movie camera|film video
🎞️|film frames|film
📽️|film projector|movie
📺|television|tv
📷|camera|photo
📸|camera with flash|photo
📹|video camera|video
🔍|magnifying glass tilted left|search find zoom
🔎|magnifying glass tilted right|search find
🕯️|candle|light
💡|light bulb|idea tip
🔦|flashlight|torch light
🏮|red paper lantern|lantern
📔|notebook with decorative cover|notebook
📕|closed book|book
📖|open book|book read docs
📗|green book|book
📘|blue book|book
📙|orange book|book
📚|books|library study
📓|notebook|notes
📒|ledger|notes
📃|page with curl|document
📜|scroll|document
📄|page facing up|document file
📰|newspaper|news
🗞️|rolled-up newspaper|news
📑|bookmark tabs|bookmark
🔖|bookmark|bookmark
🏷️|label|tag
💰|money bag|money rich
🪙|coin|money
💴|yen banknote|money
💵|dollar banknote|money cash
💶|euro banknote|money
💷|pound banknote|money
💸|money with wings|spend money
💳|credit card|payment card
🧾|receipt|invoice bill
💹|chart increasing with yen|market
✉️|envelope|mail email letter
📧|e-mail|email mail
📨|incoming envelope|mail
📩|envelope with arrow|mail send
📤|outbox tray|send upload
📥|inbox tray|receive download inbox
📦|package|box npm shipping
📫|closed mailbox with raised flag|mail
📮|postbox|mail
🗳️|ballot box with ballot|vote election
✏️|pencil|edit write
✒️|black nib|pen
🖋️|fountain pen|pen
🖊️|pen|pen
🖌️|paintbrush|paint
🖍️|crayon|draw
📝|memo|note write todo
💼|briefcase|work business job
📁|file folder|folder directory
📂|open file folder|folder
🗂️|card index dividers|organize
📅|calendar|date
📆|tear-off calendar|date
🗒️|spiral notepad|notes
🗓️|spiral calendar|calendar
📇|card index|rolodex
📈|chart increasing|graph growth up trend
📉|chart decreasing|graph down trend
📊|bar chart|chart stats analytics
📋|clipboard|clipboard copy paste
📌|pushpin|pin
📍|round pushpin|location pin map
📎|paperclip|attachment
🖇️|linked paperclips|attachment
📏|straight ruler|ruler measure
📐|triangular ruler|ruler
✂️|scissors|cut
🗃️|card file box|archive
🗄️|file cabinet|archive
🗑️|wastebasket|trash delete bin
🔒|locked|lock secure security
🔓|unlocked|unlock open
🔏|locked with pen|privacy sign
🔐|locked with key|secure encrypted
🔑|key|key password secret
🗝️|old key|key
🔨|hammer|tool build
🪓|axe|tool
⛏️|pick|mine
⚒️|hammer and pick|tools
🛠️|hammer and wrench|tools settings build
🗡️|dagger|knife
⚔️|crossed swords|fight
💣|bomb|bomb
🪃|boomerang|return
🏹|bow and arrow|archery
🛡️|shield|security protect
🪚|carpentry saw|tool
🔧|wrench|tool fix settings
🪛|screwdriver|tool
🔩|nut and bolt|tool
⚙️|gear|settings config cog
🗜️|clamp|compress
⚖️|balance scale|law justice
🦯|white cane|blind
🔗|link|link url chain
⛓️|chains|chain
🪝|hook|hook
🧰|toolbox|tools
🧲|magnet|magnet
🪜|ladder|climb
⚗️|alembic|chemistry
🧪|test tube|test science lab
🧫|petri dish|biology
🧬|dna|gene biology
🔬|microscope|science
🔭|telescope|astronomy
📡|satellite antenna|signal network
💉|syringe|vaccine injection
🩸|drop of blood|blood
💊|pill|medicine
🩹|adhesive bandage|bandage fix
🩺|stethoscope|doctor
🚪|door|door exit
🛗|elevator|lift
🪞|mirror|mirror
🪟|window|window
🛏️|bed|sleep
🛋️|couch and lamp|sofa
🪑|chair|seat
🚽|toilet|toilet
🚿|shower|shower
🛁|bathtub|bath
🧴|lotion bottle|lotion
🧷|safety pin|pin
🧹|broom|clean sweep
🧺|basket|basket
🧻|roll of paper|toilet paper
🪣|bucket|bucket
🧼|soap|clean
🪥|toothbrush|teeth
🧽|sponge|clean
🧯|fire extinguisher|fire
🛒|shopping cart|cart shop buy
🚬|cigarette|smoking
⚰️|coffin|death
🗿|moai|statue
🪧|placard|sign protest
🪪|identification card|id nid card
#symbols
🏧|atm sign|bank cash
🚮|litter in bin sign|trash
🚰|potable water|water
♿|wheelchair symbol|accessibility
🚹|mens room|toilet
🚺|womens room|toilet
🚻|restroom|toilet
🚼|baby symbol|baby
🚾|water closet|toilet wc
⚠️|warning|warning caution alert
🚸|children crossing|children
⛔|no entry|forbidden stop
🚫|prohibited|no forbidden ban
🚳|no bicycles|no
🚭|no smoking|no
🚯|no littering|no
🔞|no one under eighteen|adult 18
☢️|radioactive|danger
☣️|biohazard|danger
⬆️|up arrow|arrow up
↗️|up-right arrow|arrow
➡️|right arrow|arrow right next
↘️|down-right arrow|arrow
⬇️|down arrow|arrow down
↙️|down-left arrow|arrow
⬅️|left arrow|arrow left back
↖️|up-left arrow|arrow
↕️|up-down arrow|arrow
↔️|left-right arrow|arrow
↩️|right arrow curving left|return undo
↪️|left arrow curving right|redo
⤴️|right arrow curving up|arrow
⤵️|right arrow curving down|arrow
🔃|clockwise vertical arrows|refresh reload sync
🔄|counterclockwise arrows button|refresh reload sync
🔙|back arrow|back
🔚|end arrow|end
🔛|on arrow|on
🔜|soon arrow|soon
🔝|top arrow|top
🛐|place of worship|religion
⚛️|atom symbol|atom react science
🕉️|om|hindu
✡️|star of david|jewish
☸️|wheel of dharma|buddhist
☯️|yin yang|balance
✝️|latin cross|christian
☦️|orthodox cross|christian
☪️|star and crescent|islam muslim
☮️|peace symbol|peace
🕎|menorah|jewish
🔯|dotted six-pointed star|star
♈|aries|zodiac
♉|taurus|zodiac
♊|gemini|zodiac
♋|cancer|zodiac
♌|leo|zodiac
♍|virgo|zodiac
♎|libra|zodiac
♏|scorpio|zodiac
♐|sagittarius|zodiac
♑|capricorn|zodiac
♒|aquarius|zodiac
♓|pisces|zodiac
⛎|ophiuchus|zodiac
🔀|shuffle tracks button|shuffle random
🔁|repeat button|repeat loop
🔂|repeat single button|repeat
▶️|play button|play
⏩|fast-forward button|forward
⏭️|next track button|next
⏯️|play or pause button|pause
◀️|reverse button|back
⏪|fast reverse button|rewind
⏮️|last track button|previous
🔼|upwards button|up
⏫|fast up button|up
🔽|downwards button|down
⏬|fast down button|down
⏸️|pause button|pause
⏹️|stop button|stop
⏺️|record button|record
⏏️|eject button|eject
🎦|cinema|movie
🔅|dim button|brightness
🔆|bright button|brightness
📶|antenna bars|signal wifi network
🛜|wireless|wifi network
📳|vibration mode|phone
📴|mobile phone off|off
♀️|female sign|woman
♂️|male sign|man
⚧️|transgender symbol|transgender
✖️|multiply|times x
➕|plus|add
➖|minus|subtract
➗|divide|division
🟰|heavy equals sign|equals
♾️|infinity|forever
‼️|double exclamation mark|bang
⁉️|exclamation question mark|interrobang
❓|red question mark|question
❔|white question mark|question
❕|white exclamation mark|exclamation
❗|red exclamation mark|exclamation important
〰️|wavy dash|wave
💱|currency exchange|money
💲|heavy dollar sign|money
⚕️|medical symbol|medicine
♻️|recycling symbol|recycle
⚜️|fleur-de-lis|scouts
🔱|trident emblem|trident
📛|name badge|badge
🔰|japanese symbol for beginner|beginner
⭕|hollow red circle|circle o
✅|check mark button|done yes ok tick pass
☑️|check box with check|done
✔️|check mark|done tick
❌|cross mark|no x wrong fail error
❎|cross mark button|no
➰|curly loop|loop
➿|double curly loop|loop
〽️|part alternation mark|mark
✳️|eight-spoked asterisk|asterisk
✴️|eight-pointed star|star
❇️|sparkle|sparkle
©️|copyright|copyright c
®️|registered|registered r
™️|trade mark|trademark tm
#️⃣|keycap number sign|hash pound
*️⃣|keycap asterisk|asterisk
0️⃣|keycap 0|zero number
1️⃣|keycap 1|one number
2️⃣|keycap 2|two number
3️⃣|keycap 3|three number
🔟|keycap 10|ten
🔠|input latin uppercase|abc
🔡|input latin lowercase|abc
🔢|input numbers|1234
🔣|input symbols|symbols
🔤|input latin letters|abc
🆎|ab button (blood type)|blood
🆑|cl button|clear
🆒|cool button|cool
🆓|free button|free
ℹ️|information|info
🆔|id button|id
Ⓜ️|circled m|metro
🆕|new button|new
🆖|ng button|no good
🆗|ok button|ok
🆘|sos button|help emergency
🆙|up! button|up
🆚|vs button|versus
🔴|red circle|red dot record
🟠|orange circle|orange
🟡|yellow circle|yellow
🟢|green circle|green online
🔵|blue circle|blue
🟣|purple circle|purple
🟤|brown circle|brown
⚫|black circle|black
⚪|white circle|white
🟥|red square|red
🟧|orange square|orange
🟨|yellow square|yellow
🟩|green square|green
🟦|blue square|blue
🟪|purple square|purple
🟫|brown square|brown
⬛|black large square|black
⬜|white large square|white
🔶|large orange diamond|diamond
🔷|large blue diamond|diamond
🔸|small orange diamond|diamond
🔹|small blue diamond|diamond
🔺|red triangle pointed up|triangle
🔻|red triangle pointed down|triangle
💠|diamond with a dot|diamond
🔘|radio button|radio
🔳|white square button|square
🔲|black square button|square
🏁|chequered flag|finish race
🚩|triangular flag|flag red flag
🎌|crossed flags|flags
🏴|black flag|flag
🏳️|white flag|surrender
🏳️‍🌈|rainbow flag|pride lgbt
🏴‍☠️|pirate flag|pirate
#unicode:arrows
←|leftwards arrow|arrow left
↑|upwards arrow|arrow up
→|rightwards arrow|arrow right
↓|downwards arrow|arrow down
↔|left right arrow|arrow
↕|up down arrow|arrow
↖|north west arrow|arrow
↗|north east arrow|arrow
↘|south east arrow|arrow
↙|south west arrow|arrow
⇐|leftwards double arrow|implied by
⇒|rightwards double arrow|implies
⇔|left right double arrow|iff equivalent
⇑|upwards double arrow|arrow
⇓|downwards double arrow|arrow
↩|leftwards arrow with hook|return enter
↪|rightwards arrow with hook|redo
↺|anticlockwise open circle arrow|undo rotate
↻|clockwise open circle arrow|redo refresh rotate
⇄|rightwards arrow over leftwards arrow|swap exchange
⇆|leftwards arrow over rightwards arrow|swap
⇥|rightwards arrow to bar|tab
⇤|leftwards arrow to bar|shift tab
⏎|return symbol|enter return
⌫|erase to the left|backspace delete
⌦|erase to the right|delete
⇧|upwards white arrow|shift
⇪|upwards white arrow from bar|caps lock
⌘|place of interest sign|command cmd mac
⌥|option key|option alt mac
⌃|up arrowhead|control ctrl mac
⎋|broken circle with northwest arrow|escape esc
➜|heavy round-tipped rightwards arrow|arrow
➔|heavy wide-headed rightwards arrow|arrow
▲|black up-pointing triangle|triangle up
▼|black down-pointing triangle|triangle down
◀|black left-pointing triangle|triangle left
▶|black right-pointing triangle|triangle right play
▸|black right-pointing small triangle|bullet
▾|black down-pointing small triangle|caret dropdown
#unicode:math
±|plus-minus sign|plus minus
×|multiplication sign|times multiply
÷|division sign|divide
−|minus sign|minus subtract
≈|almost equal to|approx
≠|not equal to|not equal
≡|identical to|equivalent congruent
≤|less-than or equal to|lte
≥|greater-than or equal to|gte
≪|much less-than|less
≫|much greater-than|greater
∞|infinity|infinite
√|square root|sqrt root
∛|cube root|root
∑|n-ary summation|sum sigma
∏|n-ary product|product
∫|integral|calculus
∂|partial differential|derivative
∆|increment|delta change
∇|nabla|gradient
∈|element of|in set
∉|not an element of|set
∋|contains as member|set
⊂|subset of|set
⊃|superset of|set
⊆|subset of or equal to|set
∪|union|set
∩|intersection|set
∅|empty set|null empty
∀|for all|forall logic
∃|there exists|exists logic
¬|not sign|not logic
∧|logical and|and logic
∨|logical or|or logic
⊕|circled plus|xor
⊗|circled times|tensor
∝|proportional to|proportional
∴|therefore|therefore
∵|because|because
°|degree sign|degree temperature
′|prime|minute feet
″|double prime|second inch
‰|per mille sign|permille
½|vulgar fraction one half|half fraction
⅓|vulgar fraction one third|third fraction
¼|vulgar fraction one quarter|quarter fraction
¾|vulgar fraction three quarters|fraction
²|superscript two|squared power
³|superscript three|cubed power
ⁿ|superscript latin small letter n|power
µ|micro sign|micro
ℕ|double-struck capital n|natural numbers
ℤ|double-struck capital z|integers
ℝ|double-struck capital r|real numbers
ℚ|double-struck capital q|rational
ℂ|double-struck capital c|complex
#unicode:currency
৳|bengali rupee sign|taka bdt bangladesh currency
$|dollar sign|usd money
€|euro sign|eur money
£|pound sign|gbp money
¥|yen sign|jpy yuan money
₹|indian rupee sign|inr rupee
₨|rupee sign|rupee pkr
₩|won sign|krw korea
₽|ruble sign|rub russia
₺|turkish lira sign|try lira
₪|new sheqel sign|ils israel
₫|dong sign|vnd vietnam
₱|peso sign|php philippines
₦|naira sign|ngn nigeria
₴|hryvnia sign|uah ukraine
₿|bitcoin sign|btc crypto
¢|cent sign|cent
¤|currency sign|generic currency
﷼|rial sign|riyal sar
#unicode:box
─|box drawings light horizontal|line
│|box drawings light vertical|line
┌|box drawings light down and right|corner
┐|box drawings light down and left|corner
└|box drawings light up and right|corner tree
┘|box drawings light up and left|corner
├|box drawings light vertical and right|tree branch
┤|box drawings light vertical and left|branch
┬|box drawings light down and horizontal|tee
┴|box drawings light up and horizontal|tee
┼|box drawings light vertical and horizontal|cross
═|box drawings double horizontal|line double
║|box drawings double vertical|line double
╔|box drawings double down and right|corner double
╗|box drawings double down and left|corner double
╚|box drawings double up and right|corner double
╝|box drawings double up and left|corner double
╭|box drawings light arc down and right|rounded corner
╮|box drawings light arc down and left|rounded corner
╰|box drawings light arc up and right|rounded corner
╯|box drawings light arc up and left|rounded corner
━|box drawings heavy horizontal|line heavy
┃|box drawings heavy vertical|line heavy
█|full block|block
▓|dark shade|shade
▒|medium shade|shade
░|light shade|shade
▀|upper half block|block
▄|lower half block|block
■|black square|square
□|white square|square
▪|black small square|bullet
●|black circle|bullet dot
○|white circle|circle
◆|black diamond|diamond
◇|white diamond|diamond
★|black star|star rating
☆|white star|star rating
✓|check mark|tick done
✗|ballot x|cross wrong
#unicode:greek
α|greek small letter alpha|alpha
β|greek small letter beta|beta
γ|greek small letter gamma|gamma
δ|greek small letter delta|delta
ε|greek small letter epsilon|epsilon
ζ|greek small letter zeta|zeta
η|greek small letter eta|eta
θ|greek small letter theta|theta angle
ι|greek small letter iota|iota
κ|greek small letter kappa|kappa
λ|greek small letter lamda|lambda function
μ|greek small letter mu|mu micro mean
ν|greek small letter nu|nu
ξ|greek small letter xi|xi
π|greek small letter pi|pi 3.14
ρ|greek small letter rho|rho
σ|greek small letter sigma|sigma standard deviation
τ|greek small letter tau|tau
υ|greek small letter upsilon|upsilon
φ|greek small letter phi|phi golden
χ|greek small letter chi|chi
ψ|greek small letter psi|psi
ω|greek small letter omega|omega
Γ|greek capital letter gamma|gamma
Δ|greek capital letter delta|delta change
Θ|greek capital letter theta|big theta
Λ|greek capital letter lamda|lambda
Π|greek capital letter pi|product
Σ|greek capital letter sigma|sum
Φ|greek capital letter phi|phi
Ψ|greek capital letter psi|psi
Ω|greek capital letter omega|omega ohm big omega
#unicode:punctuation
—|em dash|dash long
–|en dash|dash range
‐|hyphen|hyphen
‑|non-breaking hyphen|nbhy hyphen
…|horizontal ellipsis|ellipsis dots
‘|left single quotation mark|quote
’|right single quotation mark|apostrophe quote
“|left double quotation mark|quote smart
”|right double quotation mark|quote smart
‚|single low-9 quotation mark|quote
„|double low-9 quotation mark|quote german
«|left-pointing double angle quotation mark|guillemet quote
»|right-pointing double angle quotation mark|guillemet quote
‹|single left-pointing angle quotation mark|quote
›|single right-pointing angle quotation mark|quote
•|bullet|bullet dot list
·|middle dot|interpunct
¶|pilcrow sign|paragraph
§|section sign|section law
†|dagger|footnote
‡|double dagger|footnote
※|reference mark|note
¡|inverted exclamation mark|spanish
¿|inverted question mark|spanish
‽|interrobang|interrobang
©|copyright sign|copyright
®|registered sign|registered
™|trade mark sign|trademark
℅|care of|c/o
№|numero sign|number
।|bengali danda|dari full stop bangla
 |no-break space|nbsp space invisible
 |narrow no-break space|nnbsp space invisible
 |thin space|space invisible
 |hair space|space invisible
 |en space|space invisible
 |em space|space invisible
　|ideographic space|space invisible
​|zero width space|zwsp invisible
‌|zero width non-joiner|zwnj invisible
‍|zero width joiner|zwj invisible
⁠|word joiner|wj invisible
﻿|zero width no-break space|bom byte order mark invisible
­|soft hyphen|shy invisible
‎|left-to-right mark|lrm invisible bidi
‏|right-to-left mark|rlm invisible bidi
️|variation selector-16|emoji presentation vs16 invisible`;

const FLAGS =
    "BD Bangladesh,IN India,PK Pakistan,NP Nepal,BT Bhutan,LK Sri Lanka,MV Maldives,MM Myanmar,CN China,JP Japan,KR South Korea,SG Singapore,MY Malaysia,ID Indonesia,TH Thailand,VN Vietnam,PH Philippines,AU Australia,NZ New Zealand,SA Saudi Arabia,AE United Arab Emirates,QA Qatar,KW Kuwait,OM Oman,BH Bahrain,TR Turkey,IR Iran,IQ Iraq,EG Egypt,MA Morocco,NG Nigeria,KE Kenya,ZA South Africa,GB United Kingdom,IE Ireland,FR France,DE Germany,NL Netherlands,BE Belgium,CH Switzerland,AT Austria,IT Italy,ES Spain,PT Portugal,SE Sweden,NO Norway,DK Denmark,FI Finland,PL Poland,CZ Czechia,UA Ukraine,RU Russia,GR Greece,US United States,CA Canada,MX Mexico,BR Brazil,AR Argentina,CL Chile,CO Colombia,EU European Union,UN United Nations";

function flagOf(cc: string): string {
    return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function loadEmoji(): EmojiItem[] {
    const out: EmojiItem[] = [];
    let category = "smileys";
    let group: string | undefined;
    const seen = new Set<string>();
    for (const line of RAW.split("\n")) {
        if (!line) continue;
        if (line.startsWith("#") && !line.includes("|")) {
            const [c, g] = line.slice(1).split(":");
            category = c;
            group = g;
            continue;
        }
        const [glyph, rawName, keywords = ""] = line.split("|");
        // Invisible characters are written as \uXXXX escapes in the template literal above.
        if (seen.has(glyph)) continue;
        seen.add(glyph);
        const tone = rawName.startsWith("~");
        out.push({ char: glyph, name: tone ? rawName.slice(1) : rawName, keywords, category, group, tone });
    }
    for (const entry of FLAGS.split(",")) {
        const cc = entry.slice(0, 2);
        const name = entry.slice(3);
        out.push({ char: flagOf(cc), name: `flag: ${name}`, keywords: `${cc.toLowerCase()} country flag`, category: "flags" });
    }
    return out;
}
