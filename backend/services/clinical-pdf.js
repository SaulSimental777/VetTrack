const legacy = require('./clinical-pdf-legacy')
const { generateModernClinicalPDF } = require('./clinical-pdf-v2')
const generateClinicalPDF = (document, options) => Number(document.contenido?.pdf_version) >= 2 ? generateModernClinicalPDF(document, options) : legacy.generateClinicalPDF(document)
module.exports = { ...legacy, generateClinicalPDF }
