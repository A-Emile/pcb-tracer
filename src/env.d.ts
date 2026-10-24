// Typ-Ergänzungen: setAttribute wandelt Werte ohnehin in Text um (aria-checked = true/false)
interface Element { setAttribute(qualifiedName: string, value: string | boolean | number): void }
