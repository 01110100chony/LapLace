import type { OmissionReason } from "@laplace/contracts";

export const omissionLabels: Record<OmissionReason, string> = {
  excluded: "Excluído pela política de captura.",
  sensitive_path: "Caminho sensível.",
  linked_path: "Link ou redirecionamento de caminho.",
  nested_project: "Pertence a outro checkout ou aos dados do aplicativo.",
  not_file: "O caminho não indica um arquivo regular.",
  missing: "O arquivo não estava disponível no início da leitura.",
  unreadable: "O arquivo não pôde ser lido.",
  too_large: "O arquivo excede o limite individual.",
  total_limit: "O arquivo excederia o limite total de bytes.",
  binary: "O arquivo é binário ou usa outra codificação.",
  changed: "O arquivo mudou ou foi removido durante a leitura.",
  duplicate_path: "A seleção já contém esse arquivo.",
  capture_invalidated: "Os bytes foram descartados com a captura.",
};
