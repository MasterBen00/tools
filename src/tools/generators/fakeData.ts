// Compact word lists for the fake data generator. Kept short on purpose (tens of entries each).

export const GLOBAL = {
    firstMale: ["James", "John", "Robert", "Michael", "David", "William", "Daniel", "Lucas", "Mateo", "Noah", "Liam", "Ethan", "Hiroshi", "Wei", "Arjun", "Omar", "Carlos", "Luca", "Felix", "Jonas", "Ivan", "Mohammed", "Samuel", "Thomas", "Oliver"],
    firstFemale: ["Mary", "Emma", "Olivia", "Sophia", "Isabella", "Mia", "Charlotte", "Amelia", "Yuki", "Mei", "Priya", "Fatima", "Sofia", "Elena", "Hannah", "Lea", "Chloe", "Grace", "Aisha", "Ana", "Laura", "Emily", "Zoe", "Nina", "Sara"],
    last: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Martinez", "Lopez", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Martin", "Lee", "Walker", "Young", "King", "Wright", "Scott", "Nguyen", "Kim", "Müller", "Schmidt", "Rossi", "Tanaka", "Patel", "Silva", "Novak", "Dubois", "Andersen", "Kowalski", "O'Connor"],
    streets: ["Maple", "Oak", "Pine", "Cedar", "Elm", "Main", "High", "Park", "Lake", "Hill", "Church", "Mill", "River", "Station", "Sunset", "Forest", "Meadow", "Willow", "Victoria", "King"],
    streetTypes: ["Street", "Avenue", "Road", "Lane", "Drive", "Boulevard", "Way", "Court", "Place", "Terrace"],
    places: [
        ["New York", "United States"], ["Austin", "United States"], ["Seattle", "United States"], ["Toronto", "Canada"], ["Vancouver", "Canada"],
        ["London", "United Kingdom"], ["Manchester", "United Kingdom"], ["Berlin", "Germany"], ["Munich", "Germany"], ["Paris", "France"],
        ["Lyon", "France"], ["Madrid", "Spain"], ["Barcelona", "Spain"], ["Milan", "Italy"], ["Amsterdam", "Netherlands"],
        ["Stockholm", "Sweden"], ["Warsaw", "Poland"], ["Tokyo", "Japan"], ["Osaka", "Japan"], ["Seoul", "South Korea"],
        ["Singapore", "Singapore"], ["Sydney", "Australia"], ["Melbourne", "Australia"], ["Bengaluru", "India"], ["Mumbai", "India"],
        ["Dubai", "United Arab Emirates"], ["São Paulo", "Brazil"], ["Mexico City", "Mexico"], ["Cape Town", "South Africa"], ["Dhaka", "Bangladesh"],
    ] as [string, string][],
    companySuffix: ["Inc.", "LLC", "Ltd.", "GmbH", "Group", "Labs", "Technologies", "Systems", "Solutions", "Partners"],
    companyWords: ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Cyberdyne", "Soylent", "Aperture", "Nimbus", "Blue Harbor", "Northwind", "Contoso", "Fabrikam", "Tailspin", "Pinecrest", "Silverline", "Brightpath"],
};

export const BD = {
    firstMale: ["Rahim", "Karim", "Abdul", "Mohammad", "Tanvir", "Rafiq", "Shakib", "Tamim", "Mehedi", "Arif", "Sabbir", "Nayeem", "Imran", "Fahim", "Rakib", "Sohel", "Jamal", "Kamal", "Hasan", "Mahmud", "Ashraful", "Anisur", "Sajib", "Riyad", "Shafiq"],
    firstFemale: ["Ayesha", "Fatema", "Nusrat", "Sadia", "Tahmina", "Shirin", "Farhana", "Sumaiya", "Jannatul", "Nasrin", "Rumana", "Taslima", "Mitu", "Sharmin", "Nabila", "Lamia", "Tania", "Rupa", "Mim", "Afroza", "Sabina", "Rehana", "Anika", "Tasnim", "Puja"],
    last: ["Rahman", "Hossain", "Islam", "Ahmed", "Uddin", "Khan", "Chowdhury", "Akter", "Begum", "Sarkar", "Miah", "Haque", "Alam", "Karim", "Talukder", "Sheikh", "Bhuiyan", "Mollah", "Siddique", "Das", "Roy", "Saha", "Paul", "Barua", "Majumder", "Biswas"],
    // [city, postal code base]; postal codes are 4 digits.
    cities: [
        ["Dhaka", 1200], ["Chattogram", 4000], ["Sylhet", 3100], ["Rajshahi", 6200], ["Khulna", 9100], ["Barishal", 8200],
        ["Rangpur", 5400], ["Mymensingh", 2200], ["Cumilla", 3500], ["Gazipur", 1700], ["Narayanganj", 1400], ["Bogura", 5800],
        ["Cox's Bazar", 4700], ["Jessore", 7400], ["Dinajpur", 5200], ["Tangail", 1900],
    ] as [string, number][],
    areas: ["Dhanmondi", "Gulshan", "Banani", "Uttara", "Mirpur", "Mohammadpur", "Bashundhara", "Motijheel", "Badda", "Agrabad", "Nasirabad", "Zindabazar", "Shaheb Bazar", "Sonadanga", "Khilgaon", "Farmgate"],
    companies: ["Padma", "Meghna", "Jamuna", "Karnaphuli", "Sundarban", "Shapla", "Bengal", "Deshi", "Sonali", "Rupali", "Nodi", "Aarong", "Bashundhara", "Lal Sobuj", "Dhaka Digital", "Bay of Bengal"],
    companySuffix: ["Ltd.", "Group", "Limited", "Technologies", "Traders", "Enterprise", "Solutions", "Industries", "Textiles", "IT"],
    // Mobile operator prefixes after +880: 13/17 Grameenphone, 14/19 Banglalink, 15 Teletalk, 16 Airtel, 18 Robi.
    operators: ["13", "14", "15", "16", "17", "18", "19"],
};

export const JOBS = ["Software Engineer", "Senior Backend Engineer", "Frontend Developer", "DevOps Engineer", "Data Analyst", "Data Scientist", "Product Manager", "Project Manager", "UX Designer", "QA Engineer", "Business Analyst", "Sales Executive", "Account Manager", "HR Specialist", "Marketing Manager", "Customer Support Agent", "Accountant", "Operations Lead", "Technical Writer", "Solutions Architect", "Database Administrator", "Security Engineer", "Mobile Developer", "CTO", "Office Administrator"];

export const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");

export const URL_WORDS = ["shop", "blog", "app", "cloud", "data", "news", "portal", "studio", "hub", "labs", "market", "travel", "learn", "health", "media"];
export const URL_PATHS = ["about", "products", "pricing", "blog", "contact", "docs", "careers", "support", "login", "faq"];
export const TLDS = ["com", "net", "org", "io", "dev", "app", "co"];
export const BD_TLDS = ["com.bd", "net.bd", "org.bd", "com"];
// Reserved example domains so generated emails never belong to real inboxes.
export const EMAIL_DOMAINS = ["example.com", "example.org", "example.net"];
