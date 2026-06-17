import type { BrandExperienceMatrixItem, EntityDifferentiationItem, MatrixType, RfpConceptType } from './types';

export type SanitizableConceptContext = {
  primaryRfpConceptType?: RfpConceptType;
  rawPrimaryRfpConceptType?: RfpConceptType;
  matrixType?: MatrixType;
  rawMatrixType?: MatrixType;
  entityDifferentiationMatrix?: EntityDifferentiationItem[];
  brandExperienceMatrix?: BrandExperienceMatrixItem[];
  productExperienceMatrix?: unknown;
  operationTrustMatrix?: unknown;
  selectedDirectionLensSet?: string[];
  activeMatrixSummary?: string;
  hasEntityDifferentiationMatrix?: boolean;
  sanitizerApplied?: boolean;
  sanitizerReason?: string;
};

export type SanitizedConceptContext<T extends SanitizableConceptContext = SanitizableConceptContext> = T & {
  primaryRfpConceptType: RfpConceptType;
  matrixType: MatrixType;
  rawPrimaryRfpConceptType?: RfpConceptType;
  rawMatrixType?: MatrixType;
  activeMatrixType: MatrixType;
  hasEntityDifferentiationMatrix: boolean;
  entityMatrixActive: boolean;
  brandMatrixActive: boolean;
  sanitizerApplied: boolean;
  sanitizerReason: string;
};

export function matrixTypeForRfpConceptType(primaryType: RfpConceptType = 'unknown'): MatrixType {
  if (primaryType === 'multi_entity_pavilion') return 'entityDifferentiationMatrix';
  if (primaryType === 'single_brand_experience' || primaryType === 'visitor_center_or_tour' || primaryType === 'pop_up_or_campaign' || primaryType === 'content_media_experience' || primaryType === 'exhibition_booth' || primaryType === 'public_sector_exhibition') return 'brandExperienceMatrix';
  if (primaryType === 'product_experience_space' || primaryType === 'technology_showcase') return 'productExperienceMatrix';
  if (primaryType === 'operation_heavy_event') return 'operationTrustMatrix';
  return 'none';
}

export function getActiveMatrix(context: SanitizableConceptContext): unknown {
  if (context.matrixType === 'entityDifferentiationMatrix') return context.entityDifferentiationMatrix ?? null;
  if (context.matrixType === 'brandExperienceMatrix') return context.brandExperienceMatrix ?? null;
  if (context.matrixType === 'productExperienceMatrix') return context.productExperienceMatrix ?? null;
  if (context.matrixType === 'operationTrustMatrix') return context.operationTrustMatrix ?? null;
  return null;
}

export function sanitizeConceptContextByRfpType<T extends SanitizableConceptContext>(context: T): SanitizedConceptContext<T> {
  const rawPrimaryRfpConceptType = context.rawPrimaryRfpConceptType ?? context.primaryRfpConceptType ?? 'unknown';
  const primaryRfpConceptType = context.primaryRfpConceptType ?? rawPrimaryRfpConceptType;
  const rawMatrixType = context.rawMatrixType ?? context.matrixType;
  const expectedMatrixType = matrixTypeForRfpConceptType(primaryRfpConceptType);
  const staleEntityMatrix = primaryRfpConceptType !== 'multi_entity_pavilion' && Boolean(context.entityDifferentiationMatrix?.length);
  const incompatibleMatrix = (context.matrixType ?? expectedMatrixType) !== expectedMatrixType;
  const matrixType = expectedMatrixType;
  const sanitizerApplied = Boolean(staleEntityMatrix || incompatibleMatrix || rawMatrixType !== matrixType || rawPrimaryRfpConceptType !== primaryRfpConceptType);
  const sanitizerReason = primaryRfpConceptType === 'multi_entity_pavilion'
    ? 'multi_entity_pavilion preserves entityDifferentiationMatrix and entity role direction lenses.'
    : staleEntityMatrix
      ? `${primaryRfpConceptType} cannot use entityDifferentiationMatrix; forced active matrix to ${matrixType}.`
      : `matrixType selected from primaryRfpConceptType=${primaryRfpConceptType}.`;

  const sanitized = {
    ...context,
    rawPrimaryRfpConceptType,
    primaryRfpConceptType,
    rawMatrixType,
    matrixType,
    activeMatrixType: matrixType,
    entityDifferentiationMatrix: matrixType === 'entityDifferentiationMatrix' ? context.entityDifferentiationMatrix ?? [] : [],
    hasEntityDifferentiationMatrix: matrixType === 'entityDifferentiationMatrix' && Boolean(context.entityDifferentiationMatrix?.length),
    entityMatrixActive: matrixType === 'entityDifferentiationMatrix',
    brandMatrixActive: matrixType === 'brandExperienceMatrix',
    sanitizerApplied,
    sanitizerReason,
  } as SanitizedConceptContext<T>;

  return sanitized;
}
