/**
 * Canva: the Connect API has no personal tokens, only an app that the owner
 * registers. The card keeps the app's client ID and secret; there is no agent
 * tool yet, because acting on a person's designs needs that person's OAuth
 * authorisation, which is not built.
 */
export const canva = {
  id: "canva",
  name: "Canva",
  appSecrets: ["CORA_CANVA_CLIENT_ID", "CORA_CANVA_CLIENT_SECRET"],
  label: "team",
  card: {
    icon: "layers",
    description: "Gli agenti preparano e aggiornano materiali di design.",
    meta: "Canva · Design",
    intro: "Gli agenti preparano materiali di design. Canva richiede un'app Canva (OAuth) intestata a te.",
    optional: {
      intro: "Canva non ha token personali: si collega solo con un'app Canva intestata a te, con client ID, client secret e autorizzazione OAuth.",
      notice: "Decidi tu: collegare Canva adesso con un'app, oppure lasciarla spenta. Senza app nessun agente può usarla.",
      off: "Canva è esclusa: nessun agente la usa e nessuna chiave è salvata.",
      start: "Collega Canva con un'app",
      restart: "Attiva Canva",
      later: "Per ora no",
      done: "Canva lasciata spenta",
    },
    modes: [{
      id: "app",
      ready: "app",
      intro: "Canva non ha token personali: si collega solo con un'app Canva intestata a te.",
      notice: "Per attivare Canva servono i dati dell'app: client ID e client secret. L'autorizzazione OAuth è il passo successivo.",
      rows: [
        { title: "L'app Canva", steps: [
          ["apri ", { href: "https://www.canva.com/developers/", text: "canva.com/developers" }, " → Your integrations → Create integration;"],
          "copia client ID e client secret;",
          ["incollali qui: finiscono nella cassaforte come ", { code: "CORA_CANVA_CLIENT_ID" }, " e ", { code: "CORA_CANVA_CLIENT_SECRET" }, ";"],
          "l'autorizzazione OAuth si completa appena l'app esiste.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Canva" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Canva" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
};
