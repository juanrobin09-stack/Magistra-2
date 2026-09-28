import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Capabilities, TeacherProfile } from '@shared/types';
import AiNotReadyCard from '@/components/generate/AiNotReadyCard';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import LoadingSkeleton from '@/components/generate/LoadingSkeleton';
import PrivacyNotice from '@/components/generate/PrivacyNotice';
import ResearchModePicker from '@/components/generate/ResearchModePicker';
import ToolPicker from '@/components/generate/ToolPicker';
import { createInitialForm, validateForm, type GenerateForm } from '@/lib/generation/request';
import { describeResearchOptions, privacyNotes, researchHints } from '@/lib/generation/research';

const PROFILE: TeacherProfile = {
  displayName: 'M. Martin', etablissement: 'Collège Jean Moulin', cycle: 'college', niveaux: ['4eme'], matierePrincipale: 'mathematiques',
};

const noop = () => {};

function fields(form: GenerateForm, showErrors = false): string {
  return renderToStaticMarkup(
    <GenerateFormFields form={form} onChange={noop} onNiveauChange={noop} problems={validateForm(form)} showErrors={showErrors} />,
  );
}

describe('ToolPicker', () => {
  it('11 outils (onglets mobiles + barre latérale), outil actif signalé', () => {
    const html = renderToStaticMarkup(<ToolPicker value="evaluation" niveau="4eme" onChange={noop} />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="(true|false)"/g)).toHaveLength(22);
    expect(html).toContain('lg:hidden');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('hidden lg:block');
    expect(html).not.toContain('w-[220px]');
  });

  it('libellés adaptés au supérieur', () => {
    const html = renderToStaticMarkup(<ToolPicker value="cours" niveau="master_1" onChange={noop} />);
    for (const label of ['TD / Exercices', 'Examen', 'Syllabus', 'Plan de module', 'Correction de copie']) expect(html).toContain(label);
  });
});

describe('GenerateFormFields', () => {
  it('libellés associés aux champs', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'cours' }));
    expect(html).toContain('for="gen-sujet"');
    expect(html).toContain('id="gen-sujet"');
    expect(html).toContain('for="gen-niveau"');
    expect(html).not.toContain('Discipline'); // collège : pas de discipline
    expect(html).not.toContain('Difficulté'); // cours : pas de difficulté
  });

  it('appréciations : trimestre, profil, nombre et texte exact', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'appreciations' }), nombreAppreciations: '12' };
    const html = fields(form);
    expect(html).toContain('Trimestre');
    expect(html).toContain('Magistra rédigera 12 appréciations');
    expect(html).toContain('id="gen-nombre"');
  });

  it('différenciation : profils cochables + zone multiligne « Exercice ou contenu à adapter »', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'differenciation' }));
    expect(html).toContain('Exercice ou contenu à adapter');
    expect(html).toMatch(/<textarea[^>]*id="gen-contenu"/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it('corrigé : zone « Travail à corriger »', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'corrige' }));
    expect(html).toContain('Travail à corriger');
    expect(html).toMatch(/<textarea[^>]*id="gen-copie"/);
  });

  it('courrier : 7 types + contexte', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'lettre_parents' }));
    expect(html).toContain('Contexte et détails');
    expect(html).not.toContain('id="gen-sujet"');
    expect(html).toContain('Réunion');
  });

  it('supérieur : discipline / UE et format CM-TD-TP-séminaire', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'cours' }), niveau: 'master_1' as const, matiere: 'informatique' as const };
    const html = fields(form);
    expect(html).toContain('Discipline / intitulé de l');
    expect(html).toContain('Séminaire');
    expect(html).not.toContain('Trimestre');
  });

  it('exercices : difficulté sans valeur par défaut', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'exercices' }));
    expect(html).toContain('Difficulté');
    expect(html).toContain('Non précisée');
    // Aucun bouton de difficulté pressé.
    const difficulty = html.slice(html.indexOf('gen-difficulte-label'));
    expect(difficulty.slice(0, difficulty.indexOf('gen-difficulte-hint'))).not.toContain('aria-pressed="true"');
  });

  it('erreurs affichées après tentative', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'cours' }), sujet: '' };
    expect(fields(form, false)).not.toContain('Indiquez un sujet.');
    expect(fields(form, true)).toContain('Indiquez un sujet.');
  });
});

const CAPS: Capabilities = {
  maxDocumentChars: 1000,
  research: { academic: true, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'local', message: "L'IA fonctionne sur cet ordinateur." },
  engineLabel: 'Ollama',
  ready: true,
};

describe('ResearchModePicker', () => {
  it('démo : modes réseau désactivés et expliqués', () => {
    const options = describeResearchOptions(CAPS, 'demo', '4eme');
    const html = renderToStaticMarkup(
      <ResearchModePicker options={options} value="documents" onChange={noop} hints={researchHints('documents', 0, '4eme', options)} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('Recherche indisponible en mode démonstration.');
  });

  it('documents + Internet seul : avertissement', () => {
    const options = describeResearchOptions(CAPS, 'local', 'master_1');
    const html = renderToStaticMarkup(
      <ResearchModePicker options={options} value="internet" onChange={noop} hints={researchHints('internet', 2, 'master_1', options)} />,
    );
    expect(html).toContain('Vos documents ne seront pas utilisés dans ce mode');
    expect(html).toContain('Internet : Wikipédia et sources académiques seulement (aucun moteur web configuré)');
  });
});

describe('PrivacyNotice', () => {
  it('note locale uniquement si privacy.level === local', () => {
    expect(renderToStaticMarkup(<PrivacyNotice notes={privacyNotes(CAPS, 'documents')} />))
      .toContain('Vos documents et générations restent sur cet ordinateur');
    const server = { ...CAPS, privacy: { level: 'server' as const, message: 'Transmis au serveur Magistra.' } };
    const html = renderToStaticMarkup(<PrivacyNotice notes={privacyNotes(server, 'academic')} />);
    expect(html).not.toContain('restent sur cet ordinateur');
    expect(html).toContain('Transmis au serveur Magistra.');
    expect(html).toContain('jamais vos documents');
  });
});

describe('AiNotReadyCard', () => {
  const render = (mode: 'local' | 'web', caps: Capabilities | null, error: string | null = null) => renderToStaticMarkup(
    <MemoryRouter>
      <AiNotReadyCard mode={mode} caps={caps} checkError={error} checking={false} onRecheck={noop} />
    </MemoryRouter>,
  );

  it('rien si l’IA est prête', () => {
    expect(render('local', CAPS)).toBe('');
  });

  it('local : lien vers la configuration de l’IA', () => {
    const html = render('local', { ...CAPS, ready: false });
    expect(html).toContain("Configurer l&#x27;intelligence artificielle");
    expect(html).toContain('href="/setup"');
    expect(html).toContain('href="/app/settings"');
  });

  it('web : serveur indisponible, sans lien /setup', () => {
    const html = render('web', { ...CAPS, ready: false, privacy: { level: 'server', message: '' } });
    expect(html).toContain("Le serveur d&#x27;IA est indisponible");
    expect(html).not.toContain('href="/setup"');
  });
});

describe('LoadingSkeleton', () => {
  it('classes statiques visibles', () => {
    const html = renderToStaticMarkup(<LoadingSkeleton />);
    expect(html).toContain('h-6 w-3/4');
    expect(html).toContain('h-4 w-full');
    expect(html).toContain('animate-shimmer');
    expect(html).not.toMatch(/h-\$\{|h-undefined/);
  });
});
