// Pages légales publiques (sans connexion) : mentions légales, politique de confidentialité, conditions d'utilisation.
//
// Les textes sont rédigés à partir du fonctionnement réel de Magistra (Clerk, Supabase, prestataire d'IA, hébergeur,
// stockage local) ; l'éditeur, son contact et son hébergeur ont des valeurs par défaut (src/lib/legal.ts) que les
// variables VITE_LEGAL_* remplacent ; une information sans valeur (l'adresse, la région de la base) n'est pas affichée.
// Le prestataire d'IA est celui que le serveur annonce (GET /api/mode) : la page reste vraie quand AI_PRESET change.
// Le site vitrine (mode « showcase ») a ses propres textes (legal/ShowcaseLegal.tsx) ; le cadre de la page et les pièces
// communes sont dans legal/LegalParts.tsx.

import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AUTHOR_NAME } from '@shared/author';
import type { ProviderInfo } from '@shared/types';
import {
  hasDatabase, hasHosting, LEGAL_NON_PROFESSIONAL_NOTICE, LEGAL_PATHS, readLegalInfo, showsNonProfessionalNotice,
  type LegalInfo, type LegalPageKind,
} from '@/lib/legal';
import { safeExternalUrl } from '@/lib/links';
import { getRuntimeConfig } from '@/lib/runtime/mode';
import type { PageMode, RuntimeMode } from '@/lib/runtime/types';
import { ContactField, Ext, HostField, LegalShell } from './legal/LegalParts';
import ShowcaseLegalPage from './legal/ShowcaseLegal';

const SECTION_CLASS = 'mb-2';

// ─── Mentions légales ──────────────────────────────────────────────────────

function Mentions({ info, mode }: { info: LegalInfo; mode: RuntimeMode }) {
  return (
    <>
      <h1>Mentions légales</h1>

      <h2>{hasHosting(mode) ? 'Éditeur du site' : "Éditeur de l'application"}</h2>
      <p className={SECTION_CLASS}>
        <strong>{info.publisher}</strong>
        {info.address && (
          <>
            <br />
            Adresse : {info.address}
          </>
        )}
        <br />
        Contact : <ContactField info={info} />
      </p>
      <p>
        Directeur ou directrice de la publication : {info.director}.
      </p>
      {hasHosting(mode) && showsNonProfessionalNotice(info) && <p>{LEGAL_NON_PROFESSIONAL_NOTICE}</p>}

      {hasHosting(mode) && (
        <>
          <h2>Hébergement</h2>
          <p>
            Hébergeur du site : <HostField info={info} />.
          </p>
          {hasDatabase(mode) && (
            <p>
              Les données des comptes (profil, historique) sont conservées dans une base de données Supabase
              {info.dataRegion && <>, région : {info.dataRegion}</>}. Le détail des prestataires figure dans la{' '}
              <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>.
            </p>
          )}
        </>
      )}

      <h2>Le logiciel Magistra</h2>
      <p>
        Magistra est une application pédagogique gratuite, conçue et développée par {AUTHOR_NAME}, dans le
        cadre du projet FutureAI (Bordeaux, France).
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Les conditions de licence applicables au logiciel sont fournies avec l’application. Les contenus que vous générez ou importez
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
        Le responsable du traitement est <strong>{info.publisher}</strong>, éditeur du site{info.address && <>, {info.address}</>}.
        Contact : <ContactField info={info} />.
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
          envoyés aux sources interrogées (Wikipédia, HAL, Crossref, OpenAlex, les sites officiels vérifiés cités par
          Wikipédia et, si l'administrateur en a configuré un, un moteur de recherche web), jamais vos documents ni votre
          profil. Si l'administrateur du serveur a indiqué une adresse de contact, elle est transmise à Crossref et à
          OpenAlex avec la requête (jamais la vôtre).
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
          <strong>Supabase</strong> : base de données (profil, historique, favoris){info.dataRegion && <>. Région : {info.dataRegion}</>}.
        </li>
        <li><strong>Hébergeur du site</strong> : <HostField info={info} />. Exécution du site et de ses fonctions serveur.</li>
      </ul>
      <ProviderBlock provider={provider} />
      <p>
        Certains de ces prestataires sont établis hors de l'Union européenne : les transferts sont alors encadrés par les
        garanties qu'ils annoncent (clauses contractuelles types, cadre de protection des données UE–États-Unis).
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
        Magistra est publié par <strong>{info.publisher}</strong>. Contact : <ContactField info={info} />.
      </p>

      <h2>2. Vos données restent chez vous</h2>
      {mode === 'local' && (
        <p>
          L'application Windows fonctionne sans compte. Votre profil, votre historique, vos favoris et vos documents sont
          conservés sur cet ordinateur. Avec l’IA locale (Ollama), vos demandes ne sont envoyées à aucun service d’IA en ligne.
          Si vous choisissez un fournisseur avec votre clé API personnelle ou un serveur distant, vos consignes et les
          extraits de documents utilisés pour générer lui sont transmis. Le fournisseur actif est indiqué avant la génération.
          La clé API est chiffrée par le système sur cet ordinateur ; vous pouvez la supprimer dans les réglages.
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

      <h2>3. Connexions externes et choix disponibles</h2>
      <ul>
        <li>
          la <strong>recherche en ligne</strong>, si vous l'activez : le sujet et les mots-clés de la demande sont envoyés
          aux sources interrogées (Wikipédia, HAL, Crossref, OpenAlex, les sites officiels vérifiés cités par Wikipédia et,
          si vous en avez indiqué un, un moteur de recherche web), jamais vos documents{mode === 'local' ? ' ;' : '.'}
        </li>
        {mode === 'local' && (
          <>
            <li>le <strong>téléchargement du moteur et des modèles d'IA</strong>, que vous lancez explicitement ;</li>
            <li>la <strong>vérification des mises à jour</strong>, au démarrage puis toutes les six heures auprès de GitHub (désactivable dans Réglages → À propos). Aucun document n’est envoyé ; GitHub reçoit les données techniques de la requête, dont l’adresse IP. L’installateur est téléchargé et lancé uniquement après votre confirmation.</li>
          </>
        )}
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
        données (JSON) ») et les effacez directement dans Réglages. Pour toute question ou pour exercer vos droits : <ContactField info={info} />.
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

/**
 * Seul le site web a des comptes, des limites de débit et peut suspendre un accès ; dans l'application Windows, avec un
 * serveur personnel ou en démonstration, Magistra fonctionne sans compte et les conditions ne parlent d'aucun de ces trois
 * points. La numérotation suit les rubriques réellement affichées.
 */
function Terms({ info, mode }: { info: LegalInfo; mode: RuntimeMode }) {
  const accounts = mode === 'web';
  const sections: { title: string; body: ReactNode }[] = [
    {
      title: 'Objet',
      body: (
        <p>
          Magistra est un assistant gratuit destiné aux enseignants : il aide à préparer des cours, exercices, évaluations et
          autres documents pédagogiques à l'aide d'une intelligence artificielle. Utiliser Magistra, c'est accepter ces
          conditions.
        </p>
      ),
    },
    {
      title: accounts ? 'Accès et compte' : 'Accès',
      body: accounts ? (
        <ul>
          <li>Le service est gratuit et destiné à un usage professionnel d'enseignement.</li>
          <li>Le compte est personnel : gardez vos identifiants confidentiels et fournissez des informations exactes.</li>
          <li>Vous pouvez supprimer vos données et votre compte à tout moment (Réglages).</li>
        </ul>
      ) : (
        <ul>
          <li>Magistra est gratuit et destiné à un usage professionnel d'enseignement.</li>
          <li>Il fonctionne sans compte : vous pouvez effacer vos données à tout moment (Réglages).</li>
        </ul>
      ),
    },
    {
      title: accounts ? 'Usage du service' : 'Usage de Magistra',
      body: (
        <>
          <p>Vous vous engagez à ne pas :</p>
          <ul>
            <li>
              utiliser {accounts ? 'le service' : 'Magistra'} pour produire ou diffuser des contenus illicites, haineux ou
              portant atteinte aux droits d'autrui ;
            </li>
            {accounts && <li>chercher à contourner les limites techniques (limites de débit, protections) ou à perturber le fonctionnement du service ;</li>}
            <li>saisir des données personnelles d'élèves (noms, notes, appréciations nominatives) ni importer des documents que vous n'avez pas le droit d'utiliser.</li>
          </ul>
        </>
      ),
    },
    {
      title: 'Contenus générés par intelligence artificielle',
      body: (
        <p>
          Les contenus sont produits par un modèle d'intelligence artificielle : ils peuvent comporter des erreurs, des
          oublis ou des références inexactes. Magistra cite les sources utilisées quand elles existent, mais vous devez les
          contrôler. L'enseignant relit, vérifie et adapte chaque contenu avant de le donner à ses élèves ; il en demeure
          responsable.
        </p>
      ),
    },
    {
      title: 'Vos contenus et la propriété intellectuelle',
      body: (
        <p>
          Vous conservez vos droits sur les contenus que vous créez avec Magistra. Vous garantissez avoir le droit
          d'utiliser les documents que vous importez. Magistra ne revendique aucun droit sur vos productions et ne les
          utilise pas pour d'autres finalités que le service. Les conditions de licence applicables au logiciel sont fournies avec l’application.
        </p>
      ),
    },
    {
      title: 'Disponibilité',
      body: accounts ? (
        <p>
          Le service est fourni gratuitement, sans garantie de disponibilité continue : il peut être interrompu pour
          maintenance, limité (nombre de demandes par minute) ou dépendre de la disponibilité de prestataires tiers.
        </p>
      ) : (
        <p>
          Magistra est fourni gratuitement, sans garantie de disponibilité continue. Les fonctions qui passent par un service
          en ligne (recherche de sources, téléchargement du moteur d'IA, recherche d'une mise à jour) dépendent de la
          disponibilité de ce service.
        </p>
      ),
    },
    {
      title: 'Responsabilité',
      body: accounts ? (
        <p>
          Le service est fourni « en l'état ». Dans les limites permises par la loi, l'éditeur n'est pas responsable des
          conséquences de l'usage des contenus générés ni des interruptions du service.
        </p>
      ) : (
        <p>
          Le logiciel est fourni « en l'état ». Dans les limites permises par la loi, l'éditeur n'est pas responsable des
          conséquences de l'usage des contenus générés ni des interruptions des services en ligne dont dépendent certaines
          fonctions.
        </p>
      ),
    },
    {
      title: 'Données personnelles',
      body: (
        <p>
          Le traitement des données est décrit dans la <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>.
        </p>
      ),
    },
    ...(accounts
      ? [{ title: 'Suspension', body: <p>L'éditeur peut suspendre un accès en cas d'usage abusif ou contraire à ces conditions.</p> }]
      : []),
    {
      title: 'Évolution des conditions et droit applicable',
      body: (
        <p>
          Ces conditions peuvent évoluer ; la version en vigueur est celle de cette page. Elles sont soumises au droit
          français. Contact : <ContactField info={info} />.
        </p>
      ),
    },
  ];
  return (
    <>
      <h1>Conditions générales d'utilisation</h1>
      {sections.map((section, i) => (
        <Fragment key={section.title}>
          <h2>{i + 1}. {section.title}</h2>
          {section.body}
        </Fragment>
      ))}
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

/**
 * `mode` : mode d'affichage ; par défaut, celui découvert au démarrage (jamais « showcase » : le site vitrine a sa propre
 * page, ShowcaseLegal.tsx, qui n'embarque pas les textes de l'application).
 */
export default function LegalPage({ page, mode: forcedMode }: { page: LegalPageKind; mode?: PageMode }) {
  const config = getRuntimeConfig();
  const mode = forcedMode ?? config.mode;
  if (mode === 'showcase') return <ShowcaseLegalPage page={page} />;
  const info = readLegalInfo(undefined, config.adminContact);
  return (
    <LegalShell page={page}>
      {page === 'mentions' && <Mentions info={info} mode={mode} />}
      {page === 'confidentialite' && <Privacy info={info} mode={mode} provider={config.providerInfo} />}
      {page === 'cgu' && <Terms info={info} mode={mode} />}
    </LegalShell>
  );
}
