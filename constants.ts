
export const ADMIN_PIN = "1234";

export const PLAN_DETAILS: { [key: string]: { name: string; classes: number } } = {
    'plan_12_mes': { name: '12 Clases / Mes (S/ 160)', classes: 12 },
    'plan_8_mes': { name: '8 Clases / Mes (S/ 140)', classes: 8 },
    'plan_kids': { name: '8 Clases Kids (S/ 150)', classes: 8 },
    'plan_20_mes': { name: '20 Clases / Mes (S/ 210)', classes: 20 }
};

export const CLASS_OPTIONS = [
    "BOX / MMA",
    "JIUJITSU GI",
    "JIUJITSU NO GI",
    "BOX KIDS",
    "LUTA LIVRE NO GI",
    "GI Y NO GI",
];

export const DAYS_OF_WEEK = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export const SEDE_COORDINATES = {
  chimbote: {
    lat: -9.082020453334579,
    lon: -78.58087718807118,
  },
  'nuevo-chimbote': {
    lat: -9.129201596947674,
    lon: -78.52676890341348,
  },
};
