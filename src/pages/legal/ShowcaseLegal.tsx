// Pages légales du SITE VITRINE (mode « showcase ») : mentions légales, politique de confidentialité et conditions
// d'utilisation d'un site qui présente Magistra et propose le téléchargement de l'application Windows — rien d'autre.
//
// Les textes décrivent ce que le site fait réellement : ni compte, ni cookie de suivi, ni formulaire, ni statistiques
// d'audience ; ses polices viennent de lui-même ; le serveur d'hébergement garde des journaux techniques ; la recherche
// de la dernière version appelle GitHub depuis le serveur du site ; le téléchargement est servi par GitHub. Aucune
// affirmation sur l'application elle-même au-delà de renvoyer à sa propre politique, affichée dans l'application.
// L'éditeur, son contact et l'hébergeur ont des valeurs par défaut (src/lib/legal.ts) que les variables VITE_LEGAL_*
// remplacent ; une information sans valeur (l'adresse) n'est simplement pas affichée.

import { Link } from 'react-router-dom';
import { AUTHOR_NAME } from '@shared/author';
import {
  LEGAL_NON_PROFESSIONAL_NOTICE, LEGAL_PATHS, readLegalInfo, showsNonProfessionalNotice, type LegalInfo, type LegalPageKind,
} from '@/lib/legal';
import { REPOSITORY_URL } from '@/lib/links';
import { ContactField, Ext, HostField, LegalShell } from './LegalParts';

const FUTUREAI_URL = 'https://futurai.space';

function Mentions({ info }: { info: LegalInfo }) {
  return (
    <>
      <h1>Mentions légales</h1>

      <h2>Éditeur du site</h2>
      <p className="mb-2">
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
      {showsNonProfessionalNotice(info) && <p>{LEGAL_NON_PROFESSIONAL_NOTICE}</p>}

      <h2>Hébergement</h2>
      <p>
        Hébergeur du site : <HostField info={info} />.
      </p>
      <p>
        Le fichier d'installation de l'application Windows n'est pas hébergé par le site : il est servi par GitHub (voir la{' '}
        <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>).
      </p>

      <h2>Ce site</h2>
      <p>
        Ce site est une vitrine : il présente Magistra et permet de télécharger l'application Windows. Magistra elle-même
        fonctionne sur l'ordinateur de l'enseignant.
      </p>

      <h2>Le logiciel Magistra</h2>
      <p>
        Magistra est un logiciel libre et gratuit, publié sous licence MIT. Son code source est consultable sur{' '}
        <Ext href={REPOSITORY_URL}>le dépôt public du projet</Ext>. Magistra est conçu et développé par {AUTHOR_NAME}, dans le
        cadre du projet <Ext href={FUTUREAI_URL}>FutureAI</Ext> (Bordeaux, France).
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Le code de Magistra est distribué selon les termes de la licence MIT. Les contenus que vous générez avec
        l'application restent les vôtres, sous réserve des droits des tiers sur les documents et sources que vous utilisez
        (voir les <Link to={LEGAL_PATHS.cgu}>conditions d'utilisation</Link>).
      </p>

      <h2>Contenus générés par intelligence artificielle</h2>
      <p>
        Ce site ne produit aucun contenu. Les contenus que l'application Magistra génère sont produits par un modèle
        d'intelligence artificielle : ils peuvent contenir des erreurs, des approximations ou des références inexactes.
        L'enseignant les relit et les vérifie avant tout usage pédagogique.
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

function Privacy({ info }: { info: LegalInfo }) {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p>
        Cette page explique ce que traite le site vitrine de Magistra, pourquoi, chez qui, pendant combien de temps, et
        comment exercer vos droits (articles 13 et suivants du RGPD).
      </p>

      <h2>1. Qui est responsable ?</h2>
      <p>
        Le responsable du traitement est <strong>{info.publisher}</strong>, éditeur du site{info.address && <>, {info.address}</>}.
        Contact : <ContactField info={info} />.
      </p>

      <h2>2. Ce que ce site ne fait pas</h2>
      <ul>
        <li>il n'a ni compte, ni connexion, ni formulaire : il ne vous demande aucune information ;</li>
        <li>il ne contient aucune publicité et ne mesure pas son audience (aucune statistique de fréquentation) ;</li>
        <li>il charge ses polices depuis lui-même : aucune requête vers un service de polices tiers.</li>
      </ul>

      <h2>3. Ce qui est traité</h2>
      <ul>
        <li>
          <strong>Journaux techniques de l'hébergeur</strong> : comme tout serveur web, l'hébergeur de ce site,{' '}
          <HostField info={info} />, conserve des journaux techniques (adresse IP, date et heure, page demandée). Ils servent
          au fonctionnement et à la sécurité du site.
        </li>
        <li>
          <strong>Recherche de la dernière version</strong> : pour afficher la version, la taille et l'empreinte de
          l'installateur, la page de téléchargement interroge le serveur du site, et c'est ce serveur, non votre navigateur,
          qui appelle GitHub. Il ne lui transmet aucune information vous concernant.
        </li>
        <li>
          <strong>Téléchargement de l'application</strong> : le fichier d'installation est servi par GitHub. En cliquant sur
          « Télécharger », votre navigateur contacte GitHub, qui traite alors les données de cette requête (dont votre
          adresse IP) selon sa propre politique de confidentialité.
        </li>
        <li>
          <strong>Liens externes</strong> : les liens vers <Ext href={FUTUREAI_URL}>FutureAI</Ext>, vers le profil
          professionnel de l'auteur et vers le dépôt GitHub du projet quittent ce site ; ces services appliquent leur propre
          politique.
        </li>
      </ul>

      <h2>4. Pourquoi, et sur quel fondement ?</h2>
      <p>
        Les journaux techniques répondent à l'intérêt légitime de l'éditeur : assurer le fonctionnement et la sécurité du
        site (art. 6.1.f du RGPD). Le site ne demande ni ne conserve aucune autre donnée vous concernant.
      </p>

      <h2>5. Qui reçoit ces données ?</h2>
      <ul>
        <li><strong>L'hébergeur du site</strong> : <HostField info={info} />.</li>
        <li><strong>GitHub</strong> : uniquement si vous téléchargez l'application.</li>
      </ul>
      <p>
        Certains de ces prestataires sont établis hors de l'Union européenne : les transferts sont alors encadrés par les
        garanties qu'ils annoncent (clauses contractuelles types, cadre de protection des données UE–États-Unis).
      </p>

      <h2>6. Combien de temps ?</h2>
      <p>
        Journaux techniques : la durée de conservation est fixée par l'hébergeur. Le site lui-même ne conserve rien d'autre.
      </p>

      <h2>7. Vos droits</h2>
      <p>
        Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de
        vos données (articles 15 à 21 du RGPD). Pour les exercer ou pour toute question : <ContactField info={info} />.
      </p>
      <p>
        Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez introduire une
        réclamation auprès de la CNIL : <Ext href="https://www.cnil.fr/fr/plaintes">www.cnil.fr/fr/plaintes</Ext>.
      </p>

      <h2>8. Cookies et stockage dans votre navigateur</h2>
      <p>
        Ce site ne dépose aucun cookie, de suivi ou autre, et n'enregistre rien dans le stockage de votre navigateur.
      </p>

      <h2>9. Magistra pour Windows</h2>
      <p>
        L'application fonctionne sur l'ordinateur de l'enseignant, sans compte, et garde ses données sur cet ordinateur. Sa
        politique de confidentialité, qui précise ce qui peut en sortir et dans quels cas, est affichée dans l'application
        (Réglages, rubrique « Confidentialité »).
      </p>
    </>
  );
}

function Terms({ info }: { info: LegalInfo }) {
  return (
    <>
      <h1>Conditions générales d'utilisation</h1>

      <h2>1. Objet</h2>
      <p>
        Ce site présente Magistra, un assistant gratuit destiné aux enseignants, et permet de télécharger son application
        Windows. Utiliser le site, c'est accepter ces conditions. Le logiciel, lui, est publié sous licence MIT.
      </p>

      <h2>2. Accès au site</h2>
      <p>Le site est gratuit, sans compte ni connexion.</p>

      <h2>3. Usage du site</h2>
      <p>Vous vous engagez à ne pas :</p>
      <ul>
        <li>chercher à contourner les protections du site ni à perturber son fonctionnement ;</li>
        <li>l'utiliser pour produire ou diffuser des contenus illicites ou portant atteinte aux droits d'autrui ;</li>
        <li>multiplier les requêtes ou les téléchargements de façon abusive.</li>
      </ul>

      <h2>4. Le logiciel et les contenus générés par intelligence artificielle</h2>
      <p>
        Les contenus que l'application génère sont produits par un modèle d'intelligence artificielle : ils peuvent
        comporter des erreurs, des oublis ou des références inexactes. Magistra cite les sources utilisées quand elles
        existent, mais vous devez les contrôler. L'enseignant relit, vérifie et adapte chaque contenu avant de le donner à
        ses élèves ; il en demeure responsable. Ne saisissez pas de données personnelles d'élèves (noms, notes, appréciations
        nominatives) et n'importez pas de documents que vous n'avez pas le droit d'utiliser.
      </p>

      <h2>5. Propriété intellectuelle</h2>
      <p>
        Le code de Magistra est distribué selon les termes de la licence MIT. Vous conservez vos droits sur les contenus
        que vous créez avec l'application ; Magistra ne revendique aucun droit sur vos productions.
      </p>

      <h2>6. Disponibilité</h2>
      <p>
        Le site est fourni gratuitement, sans garantie de disponibilité continue : il peut être interrompu pour maintenance.
        Le téléchargement de l'application dépend aussi de la disponibilité de GitHub.
      </p>

      <h2>7. Responsabilité</h2>
      <p>
        Le site et le logiciel sont fournis « en l'état ». Dans les limites permises par la loi, l'éditeur n'est pas
        responsable des conséquences de l'usage des contenus générés, des interruptions du site ou d'un téléchargement qui
        échoue.
      </p>

      <h2>8. Données personnelles</h2>
      <p>
        Le traitement des données est décrit dans la <Link to={LEGAL_PATHS.confidentialite}>politique de confidentialité</Link>.
      </p>

      <h2>9. Évolution des conditions et droit applicable</h2>
      <p>
        Ces conditions peuvent évoluer ; la version en vigueur est celle de cette page. Elles sont soumises au droit
        français. Contact : <ContactField info={info} />.
      </p>
    </>
  );
}

/** Page légale du site vitrine. `info` : informations de l'éditeur (par défaut, celles du build : VITE_LEGAL_*, sinon les valeurs par défaut). */
export default function ShowcaseLegalPage({ page, info = readLegalInfo() }: { page: LegalPageKind; info?: LegalInfo }) {
  return (
    <LegalShell page={page}>
      {page === 'mentions' && <Mentions info={info} />}
      {page === 'confidentialite' && <Privacy info={info} />}
      {page === 'cgu' && <Terms info={info} />}
    </LegalShell>
  );
}
