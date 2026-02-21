const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  // --- SECTION 1: Summary ---
  const totalActive = await prisma.fabricColour.count({ where: { isActive: true } });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0,0,0,0);
  const today = new Date();
  today.setHours(0,0,0,0);

  const yesterdayTxns = await prisma.fabricColourTransaction.findMany({
    where: { createdAt: { gte: yesterday, lt: today } },
    include: { fabricColour: { include: { fabric: { include: { material: true } } } }, party: true },
    orderBy: { createdAt: 'desc' }
  });

  const inward = yesterdayTxns.filter(t => t.txnType === 'inward');
  const outward = yesterdayTxns.filter(t => t.txnType === 'outward');

  // --- SECTION 2: Reorder Analysis (28-day) ---
  const since28d = new Date(); since28d.setDate(since28d.getDate() - 28);

  const outwardAgg = await prisma.fabricColourTransaction.groupBy({
    by: ['fabricColourId'],
    where: { txnType: 'outward', createdAt: { gte: since28d } },
    _sum: { qty: true }
  });
  const consumptionMap = {};
  outwardAgg.forEach(a => { consumptionMap[a.fabricColourId] = Number(a._sum.qty) || 0; });

  const colours = await prisma.fabricColour.findMany({
    where: { isActive: true },
    include: { fabric: { include: { material: true } }, party: true }
  });

  const analysis = colours.map(c => {
    const balance = Number(c.currentBalance) || 0;
    const consumption28d = consumptionMap[c.id] || 0;
    const avgDaily = consumption28d / 28;
    const leadTime = c.leadTimeDays || c.fabric.defaultLeadTimeDays || 14;
    const reorderPoint = avgDaily * (leadTime + 7);
    const daysOfStock = avgDaily > 0 ? Math.round(balance / avgDaily) : null;
    const minOrder = Number(c.minOrderQty || c.fabric.defaultMinOrderQty || 0);
    const suggestedQty = avgDaily > 0 ? Math.max(minOrder, Math.ceil(avgDaily * 30 - balance + avgDaily * leadTime)) : 0;

    let status = 'OK';
    if (balance <= reorderPoint * 0.5 && avgDaily > 0) status = 'ORDER NOW';
    else if (balance <= reorderPoint && avgDaily > 0) status = 'ORDER SOON';

    return {
      material: c.fabric?.material?.name || '?', fabric: c.fabric?.name || '?', colour: c.colourName || '?',
      code: c.code, unit: c.fabric?.unit || 'm', balance: Math.round(balance * 100) / 100,
      avgDaily: Math.round(avgDaily * 100) / 100, daysOfStock,
      suggestedQty, leadTime, supplier: c.party?.name || '-', status
    };
  }).sort((a, b) => {
    const order = { 'ORDER NOW': 0, 'ORDER SOON': 1, 'OK': 2 };
    return (order[a.status] - order[b.status]) || ((a.daysOfStock || 999) - (b.daysOfStock || 999));
  });

  // --- SECTION 3: Stock by Material ---
  const coloursWithStock = await prisma.fabricColour.findMany({
    where: { isActive: true, currentBalance: { gt: 0 } },
    include: { fabric: { include: { material: true } } },
    orderBy: [{ fabric: { material: { name: 'asc' } } }, { fabric: { name: 'asc' } }, { colourName: 'asc' }]
  });

  const byMaterial = {};
  coloursWithStock.forEach(c => {
    const mat = c.fabric.material.name;
    if (!byMaterial[mat]) byMaterial[mat] = { total: 0, unit: c.fabric.unit, fabrics: {} };
    byMaterial[mat].total += Number(c.currentBalance) || 0;
    const fab = c.fabric.name;
    if (!byMaterial[mat].fabrics[fab]) byMaterial[mat].fabrics[fab] = { total: 0, colours: [] };
    byMaterial[mat].fabrics[fab].total += Number(c.currentBalance) || 0;
    byMaterial[mat].fabrics[fab].colours.push({
      name: c.colourName, code: c.code,
      balance: Math.round((Number(c.currentBalance) || 0) * 100) / 100
    });
  });

  const materialOverview = Object.entries(byMaterial).map(([mat, data]) => ({
    material: mat,
    totalBalance: Math.round(data.total * 100) / 100,
    unit: data.unit,
    fabrics: Object.entries(data.fabrics).map(([fab, fd]) => ({
      fabric: fab, totalBalance: Math.round(fd.total * 100) / 100, colours: fd.colours
    })).sort((a, b) => b.totalBalance - a.totalBalance)
  })).sort((a, b) => b.totalBalance - a.totalBalance);

  // --- SECTION 4: Top Consumption (30-day) ---
  const since30d = new Date(); since30d.setDate(since30d.getDate() - 30);

  const topConsumption = await prisma.fabricColourTransaction.groupBy({
    by: ['fabricColourId'],
    where: { txnType: 'outward', createdAt: { gte: since30d } },
    _sum: { qty: true },
    orderBy: { _sum: { qty: 'desc' } },
    take: 10
  });

  const ids = topConsumption.map(t => t.fabricColourId);
  const details = await prisma.fabricColour.findMany({
    where: { id: { in: ids } },
    include: { fabric: { include: { material: true } } }
  });
  const detailMap = {};
  details.forEach(d => { detailMap[d.id] = d; });

  const totalConsumption = topConsumption.reduce((s, t) => s + (Number(t._sum.qty) || 0), 0);

  const topFabrics = topConsumption.map(t => {
    const d = detailMap[t.fabricColourId];
    const qty = Number(t._sum.qty) || 0;
    return {
      fabric: d ? `${d.fabric.material.name} > ${d.fabric.name} > ${d.colourName}` : 'Unknown',
      consumed: Math.round(qty * 100) / 100,
      unit: d?.fabric.unit || 'm',
      pctOfTotal: totalConsumption > 0 ? Math.round(qty / totalConsumption * 100) : 0
    };
  });

  // --- SECTION 5: Recent Inward (7 days) ---
  const since7d = new Date(); since7d.setDate(since7d.getDate() - 7);
  const recentInward = await prisma.fabricColourTransaction.findMany({
    where: { txnType: 'inward', createdAt: { gte: since7d } },
    include: { fabricColour: { include: { fabric: { include: { material: true } } } }, party: true },
    orderBy: { createdAt: 'desc' },
    take: 15
  });

  // --- OUTPUT ---
  console.log(JSON.stringify({
    summary: {
      totalActive,
      orderNowCount: analysis.filter(a => a.status === 'ORDER NOW').length,
      orderSoonCount: analysis.filter(a => a.status === 'ORDER SOON').length,
      totalWithStock: analysis.filter(a => a.balance > 0).length,
      yesterdayInward: { count: inward.length, totalQty: Math.round(inward.reduce((s,t) => s + Number(t.qty), 0) * 100) / 100 },
      yesterdayOutward: { count: outward.length, totalQty: Math.round(outward.reduce((s,t) => s + Number(t.qty), 0) * 100) / 100 },
    },
    reorderAlerts: {
      orderNow: analysis.filter(a => a.status === 'ORDER NOW'),
      orderSoon: analysis.filter(a => a.status === 'ORDER SOON'),
    },
    yesterdayActivity: {
      inward: inward.map(t => ({
        fabric: `${t.fabricColour.fabric.material.name} > ${t.fabricColour.fabric.name} > ${t.fabricColour.colourName}`,
        qty: Number(t.qty), unit: t.fabricColour.fabric.unit, reason: t.reason,
        supplier: t.party?.name || '-'
      })),
      outward: outward.map(t => ({
        fabric: `${t.fabricColour.fabric.material.name} > ${t.fabricColour.fabric.name} > ${t.fabricColour.colourName}`,
        qty: Number(t.qty), unit: t.fabricColour.fabric.unit, reason: t.reason
      }))
    },
    topConsumption: { total30d: totalConsumption, fabrics: topFabrics },
    materialOverview,
    recentInward: recentInward.map(t => ({
      date: t.createdAt.toISOString().split('T')[0],
      fabric: `${t.fabricColour.fabric.material.name} > ${t.fabricColour.fabric.name} > ${t.fabricColour.colourName}`,
      qty: Number(t.qty), unit: t.fabricColour.fabric.unit,
      supplier: t.party?.name || '-', reason: t.reason
    }))
  }, null, 2));
}

run().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); });
