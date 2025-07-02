const AWS = require('aws-sdk');
const axios = require('axios');
const path = require('path');

// Configuration AWS S3
const s3 = new AWS.S3();

// Extensions d'images supportées
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

exports.handler = async (event) => {
    console.log('🚀 Début du traitement de suppression d\'arrière-plan');
    console.log('📥 Événement reçu:', JSON.stringify(event, null, 2));
    
    try {
        // Parcourir tous les enregistrements S3 dans l'événement
        for (const record of event.Records) {
            await processS3Record(record);
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Traitement terminé avec succès'
            })
        };
        
    } catch (error) {
        console.error('❌ Erreur générale:', error);
        throw error;
    }
};

async function processS3Record(record) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    console.log(`📁 Traitement du fichier: ${key} dans le bucket: ${bucket}`);
    
    // Vérifier que le fichier est dans le dossier remove-bg/
    if (!key.startsWith('remove-bg/')) {
        console.log('⏭️ Fichier ignoré - pas dans le dossier remove-bg/');
        return;
    }
    
    // Vérifier que c'est une image supportée
    const fileExtension = path.extname(key).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(fileExtension)) {
        console.log(`⏭️ Fichier ignoré - extension non supportée: ${fileExtension}`);
        return;
    }
    
    // Générer le chemin de destination dans le dossier clean/
    const fileName = path.basename(key, fileExtension);
    const cleanKey = `clean/${fileName}.png`;
    
    console.log(`🎯 Traitement de: ${key} -> ${cleanKey}`);
    
    console.log('📖 Lecture du fichier depuis S3...');
    
    // Étape 1: Lire l'objet depuis S3
    let imageData;
    try {
        const s3Object = await s3.getObject({
            Bucket: bucket,
            Key: key
        }).promise();
        
        imageData = s3Object.Body;
        console.log(`✅ Fichier lu avec succès (${imageData.length} bytes)`);
    } catch (s3Error) {
        console.error('❌ Erreur lors de la lecture S3:', s3Error);
        throw s3Error;
    }
    
    // Étape 2: Appeler l'API PhotoRoom
    console.log('🎨 Appel de l\'API PhotoRoom pour supprimer l\'arrière-plan avec fond blanc...');
    
    let processedImageData;
    try {
        // Construire les données multipart manuellement
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const fileName = path.basename(key);
        
        // Construire le body multipart
        let formDataBody = '';
        formDataBody += `--${boundary}\r\n`;
        formDataBody += `Content-Disposition: form-data; name="output_format"\r\n\r\n`;
        formDataBody += `png\r\n`;
        formDataBody += `--${boundary}\r\n`;
        formDataBody += `Content-Disposition: form-data; name="bg_color"\r\n\r\n`;
        formDataBody += `white\r\n`;
        formDataBody += `--${boundary}\r\n`;
        formDataBody += `Content-Disposition: form-data; name="image_file"; filename="${fileName}"\r\n`;
        formDataBody += `Content-Type: image/${fileExtension.substring(1)}\r\n\r\n`;
        
        const formDataEnd = `\r\n--${boundary}--\r\n`;
        
        // Combiner toutes les parties
        const formDataBodyBuffer = Buffer.from(formDataBody, 'utf8');
        const formDataEndBuffer = Buffer.from(formDataEnd, 'utf8');
        const fullFormData = Buffer.concat([formDataBodyBuffer, imageData, formDataEndBuffer]);
        
        const response = await axios.post('https://sdk.photoroom.com/v1/segment', fullFormData, {
            headers: {
                'X-Api-Key': process.env.PHOTOROOM_API_KEY,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': fullFormData.length
            },
            responseType: 'arraybuffer'
        });
        
        processedImageData = Buffer.from(response.data);
        console.log(`✅ Image traitée avec succès (${processedImageData.length} bytes)`);
        
    } catch (apiError) {
        console.error('❌ Erreur lors de l\'appel API PhotoRoom:', {
            message: apiError.message,
            status: apiError.response ? apiError.response.status : 'N/A',
            statusText: apiError.response ? apiError.response.statusText : 'N/A',
            data: apiError.response ? apiError.response.data : 'N/A'
        });
        throw apiError;
    }
    
    // Étape 3: Sauvegarder l'image traitée dans S3
    console.log(`💾 Sauvegarde de l'image traitée: ${cleanKey}...`);
    
    try {
        await s3.putObject({
            Bucket: bucket,
            Key: cleanKey,
            Body: processedImageData,
            ContentType: 'image/png',
            Metadata: {
                'original-file': key,
                'processed-by': 'lambda-remove-background',
                'processing-date': new Date().toISOString()
            }
        }).promise();
        
        console.log(`✅ Image sauvegardée avec succès: ${cleanKey}`);
        
    } catch (uploadError) {
        console.error('❌ Erreur lors de la sauvegarde S3:', uploadError);
        throw uploadError;
    }
    
    console.log(`🎉 Traitement terminé avec succès pour: ${key} -> ${cleanKey}`);
}

 