/**
 * Regulatory compliance & chain-of-custody service for rocket motors and components.
 *
 * Implements safety and government regulatory compliance rules per NFPA 1122/1127,
 * NAR/TRA High Power Safety Codes, and Federal/State Explosives & Hazmat regulations:
 * 1. Chain-of-custody audit logging across all lifecycle events (purchased, received,
 *    used, sold, transferred, disposed, destroyed, lost, stolen, quarantined, returned).
 * 2. Recipient verification for High Power Rocket (HPR) motor sales and transfers:
 *    - Class A–G: Low/Mid Power (Model rocketry, no high-power certification required).
 *    - Class H–I: High Power Level 1 certification required.
 *    - Class J–L: High Power Level 2 certification required.
 *    - Class M–O: High Power Level 3 certification required.
 *    - Government explosives permit / LEUP license number tracking.
 * 3. Net Explosive Weight (NEW) / Propellant Mass storage calculations and limits.
 * 4. Chain-of-custody discrepancy, loss, theft, and quarantine alerts.
 */

export interface TransferComplianceCheckInput {
  impulseClass?: string | null
  propellantType?: string | null
  transactionType: string
  counterpartyName?: string | null
  counterpartyCertNumber?: string | null
  counterpartyCertLevel?: number | null
  counterpartyLicense?: string | null
}

export interface TransferComplianceResult {
  compliant: boolean
  isHighPower: boolean
  requiredCertLevel: number
  warnings: string[]
}

/**
 * Returns the required NAR/TRA certification level for an impulse class.
 */
export function getRequiredCertLevelForImpulse(impulseClass?: string | null): number {
  if (!impulseClass) return 0
  const c = impulseClass.trim().toUpperCase()
  if (['H', 'I'].includes(c)) return 1
  if (['J', 'K', 'L'].includes(c)) return 2
  if (['M', 'N', 'O'].includes(c)) return 3
  return 0
}

/**
 * Checks if a motor impulse class falls under High Power Rocketry (NFPA 1127).
 */
export function isHighPowerImpulse(impulseClass?: string | null): boolean {
  return getRequiredCertLevelForImpulse(impulseClass) > 0
}

/**
 * Evaluates regulatory compliance for motor or component transfers/sales.
 */
export function evaluateTransferCompliance(
  input: TransferComplianceCheckInput,
): TransferComplianceResult {
  const warnings: string[] = []
  const reqLevel = getRequiredCertLevelForImpulse(input.impulseClass)
  const isHpr = reqLevel > 0
  const isOutboundTransfer = ['sold', 'transferred_out'].includes(input.transactionType)

  if (isOutboundTransfer) {
    if (!input.counterpartyName || input.counterpartyName.trim() === '') {
      warnings.push('Recipient full name is required for chain-of-custody transfer records.')
    }

    if (isHpr) {
      // HPR Motor Sale/Transfer Rules
      if (!input.counterpartyCertNumber || input.counterpartyCertNumber.trim() === '') {
        warnings.push(
          `Regulatory Warning: Transferring High Power (Class ${input.impulseClass}) motors requires recording recipient's NAR/TRA certification number.`,
        )
      }

      if (
        input.counterpartyCertLevel !== undefined &&
        input.counterpartyCertLevel !== null &&
        input.counterpartyCertLevel < reqLevel
      ) {
        warnings.push(
          `Certification Alert: Recipient certification Level ${input.counterpartyCertLevel} is below the required Level ${reqLevel} for Class ${input.impulseClass} motors.`,
        )
      }

      // Propellant licensing notice for APCP / regulated explosives
      if (input.propellantType === 'apcp' && !input.counterpartyLicense) {
        warnings.push(
          'Compliance Notice: APCP solid propellant motor transfer should document recipient regulatory permit or LEUP/storage exemption where required by state/federal law.',
        )
      }
    }
  }

  return {
    compliant: warnings.length === 0,
    isHighPower: isHpr,
    requiredCertLevel: reqLevel,
    warnings,
  }
}

/**
 * Storage summary calculation.
 */
export interface StorageSummary {
  totalPropellantMassG: number
  totalPropellantMassKg: number
  totalPropellantMassLbs: number
  highPowerMotorCount: number
  totalUnitsOnHand: number
  magazineBreakdown: Record<string, { count: number; propellantMassG: number }>
  quarantinedCount: number
  expiredCount: number
  warnings: string[]
}

export interface InventoryItemForStorage {
  quantityOnHand: number
  storageLocation?: string | null
  propellantMassG?: number | null
  impulseClass?: string | null
  condition?: string | null
  expirationDate?: string | null
}

/**
 * Calculates total propellant storage across inventory and audits magazine limits.
 *
 * Typical default recreational/hobby safe storage guideline is 50 lbs (~22,680g)
 * without a formal explosive magazine permit.
 */
export function calculateStorageSummary(
  items: InventoryItemForStorage[],
  magazineLimitG = 22680,
): StorageSummary {
  let totalPropellantMassG = 0
  let highPowerMotorCount = 0
  let totalUnitsOnHand = 0
  let quarantinedCount = 0
  let expiredCount = 0
  const magazineBreakdown: Record<string, { count: number; propellantMassG: number }> = {}
  const now = new Date().toISOString().slice(0, 10)

  for (const item of items) {
    const qty = Math.max(0, item.quantityOnHand || 0)
    totalUnitsOnHand += qty

    const unitMass = item.propellantMassG || 0
    const itemMass = qty * unitMass
    totalPropellantMassG += itemMass

    const loc = (item.storageLocation || 'Default Storage').trim()
    if (!magazineBreakdown[loc]) {
      magazineBreakdown[loc] = { count: 0, propellantMassG: 0 }
    }
    magazineBreakdown[loc].count += qty
    magazineBreakdown[loc].propellantMassG += itemMass

    if (isHighPowerImpulse(item.impulseClass)) {
      highPowerMotorCount += qty
    }

    if (item.condition === 'quarantined') {
      quarantinedCount += qty
    }

    if (item.expirationDate && item.expirationDate < now) {
      expiredCount += qty
    }
  }

  const warnings: string[] = []
  const totalKg = totalPropellantMassG / 1000
  const totalLbs = totalPropellantMassG / 453.592

  if (totalPropellantMassG > magazineLimitG) {
    warnings.push(
      `Magazine Storage Limit Exceeded: Total Net Propellant Weight is ${totalLbs.toFixed(1)} lbs (${totalKg.toFixed(1)} kg), which exceeds the standard storage limit of ${(magazineLimitG / 453.592).toFixed(1)} lbs. Ensure approved Type 4 magazine compliance.`,
    )
  }

  if (quarantinedCount > 0) {
    warnings.push(
      `Storage Alert: ${quarantinedCount} item(s) are in Quarantined status. Segregate from flight-ready inventory.`,
    )
  }

  if (expiredCount > 0) {
    warnings.push(
      `Expiration Alert: ${expiredCount} pyrotechnic/propellant item(s) have passed their manufacturer expiration date.`,
    )
  }

  return {
    totalPropellantMassG,
    totalPropellantMassKg: totalKg,
    totalPropellantMassLbs: totalLbs,
    highPowerMotorCount,
    totalUnitsOnHand,
    magazineBreakdown,
    quarantinedCount,
    expiredCount,
    warnings,
  }
}

/**
 * Returns human-readable label and UI color badge classes for transaction types.
 */
export function getTransactionTypeBadge(type: string): {
  label: string
  badgeClasses: string
  icon: string
} {
  switch (type) {
    case 'purchased':
      return {
        label: 'Purchased / Ordered',
        badgeClasses: 'bg-blue-950/70 text-blue-300 border-blue-700/60',
        icon: '🛒',
      }
    case 'received':
      return {
        label: 'Received into Stock',
        badgeClasses: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60',
        icon: '📦',
      }
    case 'used':
      return {
        label: 'Flight Use / Fired',
        badgeClasses: 'bg-amber-950/70 text-amber-300 border-amber-700/60',
        icon: '🔥',
      }
    case 'sold':
    case 'transferred_out':
      return {
        label: 'Sold / Transferred Out',
        badgeClasses: 'bg-purple-950/70 text-purple-300 border-purple-700/60',
        icon: '🤝',
      }
    case 'transferred_in':
      return {
        label: 'Transferred In',
        badgeClasses: 'bg-teal-950/70 text-teal-300 border-teal-700/60',
        icon: '📥',
      }
    case 'disposed':
    case 'destroyed':
      return {
        label: 'Disposed / Neutralized',
        badgeClasses: 'bg-red-950/70 text-red-300 border-red-700/60',
        icon: '🗑️',
      }
    case 'lost':
    case 'stolen':
      return {
        label: 'Lost / Stolen (Reported)',
        badgeClasses: 'bg-rose-950/90 text-rose-300 border-rose-600 font-bold',
        icon: '🚨',
      }
    case 'quarantined':
      return {
        label: 'Quarantined',
        badgeClasses: 'bg-orange-950/70 text-orange-300 border-orange-700/60',
        icon: '🔒',
      }
    case 'returned':
      return {
        label: 'Returned / RMA',
        badgeClasses: 'bg-slate-800 text-slate-300 border-slate-700',
        icon: '↩️',
      }
    case 'loaned_out':
      return {
        label: 'Loaned Out',
        badgeClasses: 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60',
        icon: '📤',
      }
    case 'borrowed':
      return {
        label: 'Borrowed',
        badgeClasses: 'bg-cyan-950/70 text-cyan-300 border-cyan-700/60',
        icon: '📥',
      }
    case 'audit_adjustment':
      return {
        label: 'Audit Reconciliation',
        badgeClasses: 'bg-zinc-800 text-zinc-300 border-zinc-700',
        icon: '📋',
      }
    default:
      return {
        label: type,
        badgeClasses: 'bg-slate-800 text-slate-400 border-slate-700',
        icon: '📝',
      }
  }
}
