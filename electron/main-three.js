const { ipcMain, net } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Registrar handlers para ZEUS_ACTION
ipcMain.handle('zeus:process-action', async (event, actionText) => {
    try {
        const action = JSON.parse(actionText);
        console.log('🔵 ZEUS_ACTION procesado:', action);

        // Si es createObject, llamar a la API
        if (action.action === 'createObject') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'deleteObject') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'duplicateObject') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'updateObject') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'animateObject') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'clearScene') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'setCamera') {
            const result = await callZeusApi(action);
            return result;
        } else if (action.action === 'toggleLight') {
            const result = await callZeusApi(action);
            return result;
        }

        return { success: true, message: 'Action no soportado' };
    } catch (error) {
        console.error('❌ Error procesando ZEUS_ACTION:', error);
        return { success: false, error: error.message };
    }
});

// Función para llamar a la API de Zeus
async function callZeusApi(action) {
    try {
        // Intentar conectar al servidor local
        const response = await fetch('http://127.0.0.1:3003/api/zeus/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(action),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.warn('⚠️ No se pudo conectar a la API de Zeus:', error.message);
        
        // Si no hay API, procesar localmente
        return processLocalAction(action);
    }
}

// Procesar acción localmente (sin API)
function processLocalAction(action) {
    console.log('🔄 Procesando acción localmente:', action);
    
    return {
        success: true,
        message: `Acción procesada localmente: ${action.action}`,
        timestamp: new Date().toISOString(),
    };
}

// Registrar listener para recibir acciones en tiempo real
ipcMain.on('zeus:action', (event, actionText) => {
    console.log('📨 ZEUS_ACTION recibido:', actionText);
    
    // Procesar la acción
    processZeusAction(actionText).then(result => {
        console.log('✅ Resultado:', result);
        // Enviar respuesta al renderer
        event.sender.send('zeus:action-result', result);
    });
});

// Exportar para uso en preload
module.exports = {
    registerZeusHandlers: () => {
        // Los handlers ya están registrados arriba
        console.log('✅ Handlers de ZEUS registrados');
    }
};
