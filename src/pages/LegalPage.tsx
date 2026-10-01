// Pages légales publiques (sans connexion) : mentions légales, politique de confidentialité, conditions d'utilisation.
//
// Les textes sont rédigés à partir du fonctionnement réel de Magistra (Clerk, Supabase, prestataire d'IA, Vercel,
// stockage local) ; l'identité de l'éditeur, son contact, son hébergeur viennent des variables VITE_LEGAL_* (voir
// src/lib/legal.ts) et restent visibles comme « à compléter » tant qu'elles manquent. Le prestataire d'IA est celui
// que le serveur annonce (GET /api/mode) : la page reste vraie quand AI_PRESET change.
// Ces textes sont un PROJET à faire valider : l'avis en tête de page le dit.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, GraduationCap } from 'lucide-react';
import type { ProviderInfo } from '@shared/types';
import LegalLinks from '@/components/LegalLinks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  emailOf, LEGAL_ENV_NAMES, LEGAL_LABELS, LEGAL_PATHS, LEGAL_TITLES, readLegalInfo, type LegalField, type LegalInfo,
  type LegalPageKind,
} from '@/lib/legal';
import { REPOSITORY_URL, safeExternalUrl } from '@/lib/links';
import { getBridge } from '@/lib/runtime/local';
import { getRuntimeConfig } from '@/lib/runtime/mode';
import type { RuntimeMode } from '@/lib/runtime/types';

const SECTION_CLASS = 'mb-2';

/** Lien externe : dans l'application Windows, il s'ouvre dans le navigateur du système (pont existant). */
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => {
        const bridge = getBridge();
        if (!bridge) return;
        event.preventDefault();
        try {
          void bridge.app.openExternal(href).catch(() => undefined);
        } catch {
          // Pont indisponible : le lien reste visible.
        }
      }}
    >
      {children}
    </a>
  );
}

/** Valeur renseignée, ou marque « à compléter » bien visible (jamais un blanc silencieux). */
function Field({ info, name }: { info: LegalInfo; name: LegalField }) {
  const value = info[name];
  if (value) return <>{value}</>;
  return (
    <mark
      className="rounded bg-warning/15 px-1.5 py-0.5 font-semibold text-warning"
      data-legal-todo={name}
    >
      [à compléter : {LEGAL_LABELS[name].toLowerCase()}]
    </mark>
  );
}

function ContactField({ info }: { info: LegalInfo }) {
  const { contact } = info;
  const email = emailOf(contact);
  if (!contact || !email) return <Field info={info} name="contact" />;
  // Seule l'adresse e-mail devient un lien ; le reste du texte (« Service X, … ») est affiché tel quel.
  const at = contact.indexOf(email);
  return (
    <>
      {contact.slice(0, at)}
      <a href={`mailto:${email}`}>{email}</a>
      {contact.slice(at + email.length)}
    </>
  );
}

/** Informations que chaque page affiche vraiment : seules celles-là sont listées « à compléter ». */
function relevantFields(page: LegalPageKind, mode: RuntimeMode): LegalField[] {
  if (page === 'cgu') return ['contact'];
  const web = mode === 'web';
  if (page === 'mentions') {
    return web ? ['publisher', 'director', 'address', 'contact', 'host', 'dataRegion'] : ['publisher', 'director', 'address', 'contact'];
  }
  return web ? ['publisher', 'address', 'contact', 'host', 'dataRegion'] : ['publisher', 'contact'];
}

function DraftNotice({ info, fields }: { info: LegalInfo; fields: LegalField[] }) {
  const missing = fields.filter(field => info.missing.includes(field));
  return (
    <div role="note" className="mb-8 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-mg-50">
      <p className="flex items-start gap-2 font-semibold text-warning">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Projet de texte, à faire valider avant mise en ligne</span>
      </p>
      <p className="mt-1.5">
        Ce texte a été rédigé à partir du fonctionnement réel de Magistra. Il s'agit d'un modèle de départ : il doit être
        relu et validé par l'éditeur du site (et, au besoin, par un conseil juridique) avant d'être considéré comme
        définitif.
      </p>
      {missing.length > 0 && (
        <div className="mt-2" data-legal-missing>
          <p className="font-semibold">Informations à compléter par l'éditeur du site :</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map(field => (
              <li key={field}>
                {LEGAL_LABELS[field]} — variable de build <code>{LEGAL_ENV_NAMES[field]}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Mentions légales ──────────────────────────────────────────────────────

function Mentions({ info, mode }: { info: LegalInfo; mode: RuntimeMode }) {
  return (
    <>
      <h1>Mentions légales</h1>

      <h2>Éditeur du site</h2>
      <p className={SECTION_CLASS}>
        <strong><Field info={info} name="publisher" /></strong>
        <br />
        Adresse : <Field info={info} name="address" />
        <br />
        Contact : <ContactField info={info} />
      </p>
      <p>
        Directeur ou directrice de la publication : <Field info={info} name="director" />.
      </p>

      {mode !== 'local' && (
        <>
          <h2>Hébergement</h2>
          <p>
            Hébergeur du site : <Field info={info} name="host" />.
          </p>
          <p>
            Les données des comptes (profil, historique) sont conservées dans une base de données Supabase, région :{' '}
            <Field info={info} name="dataRegion" />. Le détail des prestataires figure dans la{' '}
            <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>.
          </p>
        </>
      )}

      <h2>Le logiciel Magistra</h2>
      <p>
        Magistra est un logiciel libre et gratuit, publié sous licence MIT. Son code source est consultable sur{' '}
        <Ext href={REPOSITORY_URL}>le dépôt public du projet</Ext>. Le projet est conçu par FutureAI (Bordeaux, France).
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Le code de Magistra est distribué selon les termes de la licence MIT. Les contenus que vous générez ou importez
        restent les vôtres, sous réserve des droits des tiers sur les documents et sources que vous utilisez (voir les{' '}
        <Link to={LEGAL_PATHS.cgu}>conditions d'utilisation</Link>).
      </p>

      <h2>Contenus générés par intelligence artificielle</h2>
      <p>
        Les contenus produits par Magistra sont générés par un modèle d'intelligence artificielle. Ils peuvent contenir des
        erreurs, des approximations ou des références inexactes : l'enseignant les relit et les vérifie avant tout usage
        pédagogique.
      </p>

      <h2>Données personnelles</h2>
      <p>
        Le traitement des données personnelles est décrit dans la{' '}
        <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>, qui précise aussi comment exercer vos
        droits.
      </p>
    </>
  );
}

// ─── Politique de confidentialité ──────────────────────────────────────────

function ProviderBlock({ provider }: { provider: ProviderInfo | undefined }) {
  if (!provider) {
    return (
      <p>
        <strong>Prestataire d'intelligence artificielle.</strong> Le prestataire qui reçoit vos demandes est nommé dans
        l'application (page « Générer » et Réglages, rubrique « Confidentialité ») avec son pays, la durée de conservation
        et l'usage des textes qu'il annonce.
      </p>
    );
  }
  const url = safeExternalUrl(provider.privacyUrl);
  return (
    <div data-legal-provider>
      <p>
        <strong>Prestataire d'intelligence artificielle : {provider.label}</strong>
        {provider.thirdParty
          ? ' (service en ligne : les demandes et les extraits de documents que vous choisissez lui sont envoyés pour la génération).'
          : ' (IA locale ou du réseau de l\'éditeur : les textes ne sont pas envoyés à un service en ligne tiers).'}
      </p>
      <ul>
        {provider.country && <li>Pays ou lieu d'hébergement : {provider.country}.</li>}
        {provider.retention && <li>Conservation des données, telle que le prestataire l'annonce : {provider.retention}.</li>}
        {provider.training && <li>Utilisation des textes pour entraîner des modèles, telle que le prestataire l'annonce : {provider.training}.</li>}
        {url && <li>Conditions et confidentialité du prestataire : <Ext href={url}>{url}</Ext>.</li>}
      </ul>
    </div>
  );
}

function RightsAndComplaint({ info }: { info: LegalInfo }) {
  return (
    <>
      <p>
        Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de
        vos données (articles 15 à 21 du RGPD). Pour les exercer, la plupart des démarches sont possibles directement dans
        l'application, sans nous écrire :
      </p>
      <ul>
        <li>accès et portabilité : Réglages → « Compte et données » → « Télécharger toutes mes données (JSON) » ;</li>
        <li>rectification : Réglages → « Profil enseignant » → « Modifier mon profil » ; adresse e-mail et mot de passe : « Gérer mon compte » ;</li>
        <li>effacement : Réglages → « Supprimer toutes mes données Magistra » (historique, favoris et profil), puis suppression du compte de connexion depuis « Gérer mon compte ».</li>
      </ul>
      <p>
        Pour toute autre demande (opposition, limitation) ou question : <ContactField info={info} />.
      </p>
      <p>
        Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez introduire une
        réclamation auprès de la CNIL : <Ext href="https://www.cnil.fr/fr/plaintes">www.cnil.fr/fr/plaintes</Ext>.
      </p>
    </>
  );
}

function PrivacyWeb({ info, provider }: { info: LegalInfo; provider: ProviderInfo | undefined }) {
  return (
    <>
      <h2>1. Qui est responsable de vos données ?</h2>
      <p>
        Le responsable du traitement est <strong><Field info={info} name="publisher" /></strong>, {' '}
        <Field info={info} name="address" />. Contact : <ContactField info={info} />.
      </p>

      <h2>2. Quelles données sont traitées ?</h2>
      <ul>
        <li>
          <strong>Compte de connexion</strong> (service Clerk) : adresse e-mail, identifiant du compte, méthode de
          connexion et cookies de session. Magistra ne voit jamais votre mot de passe.
        </li>
        <li>
          <strong>Contrôle anti-robot</strong> : à l'inscription ou à la connexion, Clerk peut afficher un contrôle de
          sécurité (Cloudflare Turnstile) qui traite des données techniques (adresse IP, caractéristiques du navigateur)
          pour distinguer un humain d'un robot.
        </li>
        <li>
          <strong>Profil enseignant</strong> : nom affiché, établissement, cycle, niveaux, matières et discipline que vous
          renseignez.
        </li>
        <li>
          <strong>Historique et favoris</strong> : contenus générés, sujet, niveau, matière, sources citées et paramètres
          de la demande (consignes, options). Le texte de vos documents importés n'est jamais enregistré dans l'historique.
        </li>
        <li>
          <strong>Demandes envoyées à l'intelligence artificielle</strong> : le sujet, les consignes et les extraits des
          documents que vous choisissez d'utiliser. Vos fichiers d'origine ne quittent pas votre navigateur ; Magistra ne
          conserve pas ces extraits.
        </li>
        <li>
          <strong>Recherche en ligne</strong> (si vous l'activez) : seuls le sujet et les mots-clés de la demande sont
          envoyés aux sources interrogées (Wikipédia, HAL, Crossref, sites institutionnels ou web), jamais vos documents
          ni votre profil.
        </li>
        <li>
          <strong>Journal technique</strong> : identifiant du compte et horaire des demandes de génération, pour limiter
          les abus. Ces lignes sont supprimées automatiquement au bout d'environ deux jours.
        </li>
      </ul>
      <p>
        Magistra ne contient ni publicité, ni outil de mesure d'audience, ni pistage, et ne revend aucune donnée. Les
        polices du site sont hébergées par Magistra : aucune requête vers un service de polices tiers.
      </p>

      <h2>3. Pourquoi, et sur quel fondement ?</h2>
      <ul>
        <li>
          Fournir le service (compte, génération, historique, favoris) : exécution du contrat formé par les{' '}
          <Link to={LEGAL_PATHS.cgu}>conditions d'utilisation</Link> (art. 6.1.b du RGPD).
        </li>
        <li>
          Assurer la sécurité du service et lutter contre les abus (limites de débit, journal technique) : intérêt
          légitime de l'éditeur (art. 6.1.f).
        </li>
      </ul>

      <h2>4. Qui reçoit vos données ?</h2>
      <p>Les données sont traitées par des prestataires techniques (sous-traitants) :</p>
      <ul>
        <li><strong>Clerk</strong> : création et gestion des comptes, connexion, cookies de session.</li>
        <li><strong>Cloudflare (Turnstile, via Clerk)</strong> : contrôle anti-robot lors de la connexion.</li>
        <li>
          <strong>Supabase</strong> : base de données (profil, historique, favoris). Région :{' '}
          <Field info={info} name="dataRegion" />.
        </li>
        <li><strong>Vercel</strong> : exécution du site et de ses fonctions serveur. Hébergeur : <Field info={info} name="host" />.</li>
      </ul>
      <ProviderBlock provider={provider} />
      <p>
        Certains de ces prestataires sont établis hors de l'Union européenne : les transferts sont alors encadrés par les
        garanties qu'ils annoncent (clauses contractuelles types, cadre de protection des données UE–États-Unis). Ces
        garanties sont à vérifier par l'éditeur avant publication.
      </p>

      <h2>5. Combien de temps ?</h2>
      <ul>
        <li>Profil, historique et favoris : tant que votre compte existe et que vous ne les supprimez pas.</li>
        <li>Compte de connexion : jusqu'à sa suppression (« Gérer mon compte »).</li>
        <li>Journal technique des demandes : environ deux jours.</li>
        <li>Copie hors ligne du profil dans votre navigateur : effacée à la déconnexion.</li>
        {provider?.retention && <li>Chez le prestataire d'intelligence artificielle : {provider.retention}.</li>}
      </ul>

      <h2>6. Vos droits</h2>
      <RightsAndComplaint info={info} />

      <h2>7. Cookies et stockage dans votre navigateur</h2>
      <p>
        Magistra n'utilise <strong>aucun cookie publicitaire ni de mesure d'audience</strong>. Seuls sont déposés les
        éléments strictement nécessaires au fonctionnement, qui ne demandent pas de consentement :
      </p>
      <ul>
        <li>les cookies de session de Clerk (authentification) ;</li>
        <li>
          le stockage local du navigateur : copie hors ligne de votre profil (effacée à la déconnexion), choix du moteur
          d'intelligence artificielle, appairage éventuel de Magistra locale.
        </li>
      </ul>

      <h2>8. Données d'élèves</h2>
      <p>
        Magistra n'a pas besoin de données personnelles d'élèves. Ne saisissez ni noms, ni notes, ni appréciations
        nominatives dans vos demandes ou vos documents (y compris pour l'outil « Corrigé »). Ces textes seraient envoyés
        au prestataire d'intelligence artificielle ; l'enseignant et son établissement en restent responsables.
      </p>

      <h2>9. Magistra pour Windows</h2>
      <p>
        L'application Windows fonctionne sans compte et garde vos données sur l'ordinateur. Utilisée depuis le site
        (« Magistra locale »), elle génère le contenu sur votre ordinateur ; le résultat et les paramètres de la demande
        sont alors enregistrés dans l'historique de votre compte, comme toute génération.
      </p>
    </>
  );
}

function PrivacyLocal({ info, mode }: { info: LegalInfo; mode: RuntimeMode }) {
  return (
    <>
      <h2>1. Responsable</h2>
      <p>
        Magistra est publié par <strong><Field info={info} name="publisher" /></strong>. Contact :{' '}
        <ContactField info={info} />.
      </p>

      <h2>2. Vos données restent chez vous</h2>
      {mode === 'local' && (
        <p>
          L'application Windows fonctionne sans compte. Votre profil, votre historique, vos favoris et vos documents sont
          conservés sur cet ordinateur, et l'intelligence artificielle (Ollama) y tourne en local : vos demandes ne sont
          envoyées à aucun service d'IA en ligne.
        </p>
      )}
      {mode === 'personal' && (
        <p>
          Ce serveur Magistra fonctionne sur votre propre ordinateur, sans compte. Vos données y restent. Selon la
          configuration, les demandes sont envoyées à l'intelligence artificielle installée sur l'ordinateur ou à un
          service en ligne que l'application nomme dans « Réglages → Confidentialité ».
        </p>
      )}
      {mode === 'demo' && (
        <p>
          Cette version de démonstration n'a ni compte ni serveur : les exemples sont pré-rédigés et ce que vous saisissez
          reste dans ce navigateur.
        </p>
      )}

      <h2>3. Ce qui peut sortir de votre ordinateur, uniquement à votre demande</h2>
      <ul>
        <li>
          la <strong>recherche en ligne</strong>, si vous l'activez : le sujet et les mots-clés de la demande sont envoyés
          aux sources interrogées (Wikipédia, HAL, Crossref, sites institutionnels ou web), jamais vos documents ;
        </li>
        {mode === 'local' && (
          <>
            <li>le <strong>téléchargement du moteur et des modèles d'IA</strong>, que vous lancez explicitement ;</li>
            <li>la <strong>recherche d'une mise à jour</strong>, au clic, auprès du dépôt officiel du projet ;</li>
          </>
        )}
        <li>
          l'utilisation du <strong>site Magistra</strong> avec cet ordinateur, si vous le décidez : voir la politique de
          confidentialité du site.
        </li>
      </ul>

      <h2>4. Cookies</h2>
      <p>Aucun cookie publicitaire, aucune mesure d'audience, aucun pistage.</p>

      <h2>5. Données d'élèves</h2>
      <p>
        Évitez de saisir des données personnelles d'élèves (noms, notes, appréciations) dans vos demandes et documents.
      </p>

      <h2>6. Vos droits</h2>
      <p>
        Vos données étant sur votre ordinateur, vous les consultez, les exportez (Réglages → « Télécharger toutes mes
        données (JSON) ») et les effacez directement dans Réglages. Pour toute question : <ContactField info={info} />.
        Vous pouvez saisir la CNIL : <Ext href="https://www.cnil.fr/fr/plaintes">www.cnil.fr/fr/plaintes</Ext>.
      </p>
    </>
  );
}

function Privacy({ info, mode, provider }: { info: LegalInfo; mode: RuntimeMode; provider: ProviderInfo | undefined }) {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p>
        Cette page explique quelles données Magistra traite, pourquoi, chez qui, pendant combien de temps, et comment
        exercer vos droits (articles 13 et suivants du RGPD).
      </p>
      {mode === 'web' ? <PrivacyWeb info={info} provider={provider} /> : <PrivacyLocal info={info} mode={mode} />}
    </>
  );
}

// ─── Conditions générales d'utilisation ────────────────────────────────────

function Terms({ info }: { info: LegalInfo }) {
  return (
    <>
      <h1>Conditions générales d'utilisation</h1>

      <h2>1. Objet</h2>
      <p>
        Magistra est un assistant gratuit destiné aux enseignants : il aide à préparer des cours, exercices, évaluations et
        autres documents pédagogiques à l'aide d'une intelligence artificielle. Utiliser Magistra, c'est accepter ces
        conditions.
      </p>

      <h2>2. Accès et compte</h2>
      <ul>
        <li>Le service est gratuit et destiné à un usage professionnel d'enseignement.</li>
        <li>Le compte est personnel : gardez vos identifiants confidentiels et fournissez des informations exactes.</li>
        <li>Vous pouvez supprimer vos données et votre compte à tout moment (Réglages).</li>
      </ul>

      <h2>3. Usage du service</h2>
      <p>Vous vous engagez à ne pas :</p>
      <ul>
        <li>utiliser le service pour produire ou diffuser des contenus illicites, haineux ou portant atteinte aux droits d'autrui ;</li>
        <li>chercher à contourner les limites techniques (limites de débit, protections) ou à perturber le fonctionnement du service ;</li>
        <li>saisir des données personnelles d'élèves (noms, notes, appréciations nominatives) ni importer des documents que vous n'avez pas le droit d'utiliser.</li>
      </ul>

      <h2>4. Contenus générés par intelligence artificielle</h2>
      <p>
        Les contenus sont produits par un modèle d'intelligence artificielle : ils peuvent comporter des erreurs, des
        oublis ou des références inexactes. Magistra cite les sources utilisées quand elles existent, mais vous devez les
        contrôler. L'enseignant relit, vérifie et adapte chaque contenu avant de le donner à ses élèves ; il en demeure
        responsable.
      </p>

      <h2>5. Vos contenus et la propriété intellectuelle</h2>
      <p>
        Vous conservez vos droits sur les contenus que vous créez avec Magistra. Vous garantissez avoir le droit
        d'utiliser les documents que vous importez. Magistra ne revendique aucun droit sur vos productions et ne les
        utilise pas pour d'autres finalités que le service. Le logiciel est publié sous licence MIT.
      </p>

      <h2>6. Disponibilité</h2>
      <p>
        Le service est fourni gratuitement, sans garantie de disponibilité continue : il peut être interrompu pour
        maintenance, limité (nombre de demandes par minute) ou dépendre de la disponibilité de prestataires tiers.
      </p>

      <h2>7. Responsabilité</h2>
      <p>
        Le service est fourni « en l'état ». Dans les limites permises par la loi, l'éditeur n'est pas responsable des
        conséquences de l'usage des contenus générés ni des interruptions du service.
      </p>

      <h2>8. Données personnelles</h2>
      <p>
        Le traitement des données est décrit dans la <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>.
      </p>

      <h2>9. Suspension</h2>
      <p>L'éditeur peut suspendre un accès en cas d'usage abusif ou contraire à ces conditions.</p>

      <h2>10. Évolution des conditions et droit applicable</h2>
      <p>
        Ces conditions peuvent évoluer ; la version en vigueur est celle de cette page. Elles sont soumises au droit
        français. Contact : <ContactField info={info} />.
      </p>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────


export default function LegalPage({ page }: { page: LegalPageKind }) {
  useDocumentTitle(LEGAL_TITLES[page]);
  const config = getRuntimeConfig();
  const info = readLegalInfo(undefined, config.adminContact);
  const mode = config.mode;
  return (
    <div className="min-h-screen bg-mg-900">
      <header className="border-b border-white/5">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 text-white" aria-label="Magistra, retour à l'accueil">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-accent">.</span>
            </span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-mg-200 hover:text-white">
            <ArrowLeft size={14} aria-hidden="true" /> Retour
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <nav aria-label="Pages légales" className="mb-6 text-sm text-mg-200">
          <LegalLinks />
        </nav>
        <DraftNotice info={info} fields={relevantFields(page, mode)} />
        <div className="prose-content">
          {page === 'mentions' && <Mentions info={info} mode={mode} />}
          {page === 'confidentialite' && <Privacy info={info} mode={mode} provider={config.providerInfo} />}
          {page === 'cgu' && <Terms info={info} />}
        </div>
      </main>
    </div>
  );
}
