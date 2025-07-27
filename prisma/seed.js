const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

/**
 * Função para gerar username único a partir do nome completo
 */
function generateUsername(fullName) {
  return fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9\s]/g, '') // Remove caracteres especiais
    .replace(/\s+/g, '_') // Substitui espaços por underscore
    .substring(0, 20); // Limita a 20 caracteres
}

/**
 * Função para gerar código de convite único
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Função principal de seed
 */
async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  try {
    // Limpar dados existentes para permitir re-execução do seed
    console.log('🧹 Limpando dados existentes...');
    await prisma.game.deleteMany();
    await prisma.prize.deleteMany();
    await prisma.scratchCard.deleteMany();
    await prisma.inviteCode.deleteMany();
    await prisma.withdraw.deleteMany();
    await prisma.deposit.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.user.deleteMany();
    console.log('✅ Dados limpos com sucesso!');

    // Hash das senhas
    const passwordHash = await bcrypt.hash('123456', 12);
    const adminPasswordHash = await bcrypt.hash('admin123', 12);

    console.log('👤 Criando usuário administrador...');
    
    // Criar usuário administrador
    const adminUser = await prisma.user.create({
      data: {
        email: 'admin@bonni.com',
        phone: '+5511999999999',
        password: adminPasswordHash,
        full_name: 'Administrador Sistema',
        cpf: '11111111111',
        username: generateUsername('Administrador Sistema'),
        is_admin: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criar carteira para o administrador
    await prisma.wallet.create({
      data: {
        userId: adminUser.id,
        balance: 1000.00, // Saldo inicial de R$ 1000
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    console.log('✅ Usuário administrador criado:');
    console.log(`   📧 Email: ${adminUser.email}`);
    console.log(`   📱 Telefone: ${adminUser.phone}`);
    console.log(`   🔑 Senha: admin123`);
    console.log(`   👤 Username: ${adminUser.username}`);
    console.log(`   🆔 ID: ${adminUser.id}`);

    console.log('\n👤 Criando usuário normal...');
    
    // Criar usuário normal
    const normalUser = await prisma.user.create({
      data: {
        email: 'usuario@bonni.com',
        phone: '+5511888888888',
        password: passwordHash,
        full_name: 'João Silva Santos',
        cpf: '12345678901',
        username: generateUsername('João Silva Santos'),
        is_admin: false,
        invitedBy: adminUser.id, // Convidado pelo admin
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criar carteira para o usuário normal
    await prisma.wallet.create({
      data: {
        userId: normalUser.id,
        balance: 50.00, // Saldo inicial de R$ 50
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criar código de convite para o admin
    await prisma.inviteCode.create({
      data: {
        userId: adminUser.id,
        code: generateInviteCode(),
        total_invites: 1,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criar código de convite para o usuário normal
    await prisma.inviteCode.create({
      data: {
        userId: normalUser.id,
        code: generateInviteCode(),
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    console.log('✅ Usuário normal criado:');
    console.log(`   📧 Email: ${normalUser.email}`);
    console.log(`   📱 Telefone: ${normalUser.phone}`);
    console.log(`   🔑 Senha: 123456`);
    console.log(`   👤 Username: ${normalUser.username}`);
    console.log(`   🆔 ID: ${normalUser.id}`);
    console.log(`   👥 Convidado por: ${adminUser.full_name}`);

    console.log('\n🎮 Criando raspadinhas de exemplo...');
    
    // Criar raspadinha básica - R$ 1,00
    const basicScratchCard = await prisma.scratchCard.create({
      data: {
        name: 'Raspadinha Básica',
        description: 'Sua primeira chance de ganhar! Prêmios de até R$ 10,00',
        price: 1.00,
        image_url: '/images/scratch-basic.svg',
        target_rtp: 85.00,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Prêmios para raspadinha básica
    await prisma.prize.createMany({
      data: [
        {
          scratchCardId: basicScratchCard.id,
          name: 'R$ 10,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 10.00,
          probability: 2.0, // 2% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: basicScratchCard.id,
          name: 'R$ 5,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 5.00,
          probability: 5.0, // 5% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: basicScratchCard.id,
          name: 'R$ 2,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 2.00,
          probability: 15.0, // 15% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ]
    });

    // Criar raspadinha premium - R$ 5,00
    const premiumScratchCard = await prisma.scratchCard.create({
      data: {
        name: 'Raspadinha Premium',
        description: 'Prêmios maiores te esperam! Ganhe até R$ 100,00',
        price: 5.00,
        image_url: '/images/scratch-premium.svg',
        target_rtp: 88.00,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Prêmios para raspadinha premium
    await prisma.prize.createMany({
      data: [
        {
          scratchCardId: premiumScratchCard.id,
          name: 'R$ 100,00',
          description: 'Grande prêmio em dinheiro',
          type: 'MONEY',
          value: 100.00,
          probability: 1.0, // 1% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: premiumScratchCard.id,
          name: 'R$ 50,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 50.00,
          probability: 2.0, // 2% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: premiumScratchCard.id,
          name: 'R$ 25,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 25.00,
          probability: 5.0, // 5% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: premiumScratchCard.id,
          name: 'R$ 10,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 10.00,
          probability: 10.0, // 10% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ]
    });

    // Criar raspadinha especial - R$ 10,00
    const specialScratchCard = await prisma.scratchCard.create({
      data: {
        name: 'Raspadinha Especial',
        description: 'Prêmios incríveis! Dinheiro e produtos exclusivos',
        price: 10.00,
        image_url: '/images/scratch-special.svg',
        target_rtp: 90.00,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Prêmios para raspadinha especial
    await prisma.prize.createMany({
      data: [
        {
          scratchCardId: specialScratchCard.id,
          name: 'R$ 500,00',
          description: 'Prêmio máximo em dinheiro',
          type: 'MONEY',
          value: 500.00,
          probability: 0.5, // 0.5% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: specialScratchCard.id,
          name: 'iPhone 15',
          description: 'Smartphone Apple iPhone 15 128GB',
          type: 'PRODUCT',
          product_name: 'iPhone 15 128GB',
          redemption_value: 400.00,
          probability: 0.2, // 0.2% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: specialScratchCard.id,
          name: 'R$ 100,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 100.00,
          probability: 3.0, // 3% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: specialScratchCard.id,
          name: 'R$ 50,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 50.00,
          probability: 5.0, // 5% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          scratchCardId: specialScratchCard.id,
          name: 'R$ 20,00',
          description: 'Prêmio em dinheiro',
          type: 'MONEY',
          value: 20.00,
          probability: 8.0, // 8% de chance
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ]
    });

    console.log('✅ Raspadinhas criadas:');
    console.log(`   🎮 ${basicScratchCard.name} - R$ ${basicScratchCard.price}`);
    console.log(`   🎮 ${premiumScratchCard.name} - R$ ${premiumScratchCard.price}`);
    console.log(`   🎮 ${specialScratchCard.name} - R$ ${specialScratchCard.price}`);

    console.log('\n📊 Resumo do seed:');
    console.log('   👨‍💼 1 Administrador criado');
    console.log('   👤 1 Usuário normal criado');
    console.log('   💰 2 Carteiras criadas');
    console.log('   🎫 2 Códigos de convite criados');
    console.log('   🔗 1 Relação de convite estabelecida');
    console.log('   🎮 3 Raspadinhas criadas');
    console.log('   🏆 11 Prêmios configurados');
    
    console.log('\n🎉 Seed concluído com sucesso!');
    console.log('\n🎮 Raspadinhas disponíveis:');
    console.log('   • Básica (R$ 1,00) - RTP: 85%');
    console.log('   • Premium (R$ 5,00) - RTP: 88%');
    console.log('   • Especial (R$ 10,00) - RTP: 90%');
    
  } catch (error) {
    console.error('❌ Erro durante o seed:', error);
    throw error;
  }
}

// Executar seed
main()
  .catch((e) => {
    console.error('💥 Erro fatal no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('🔌 Conexão com banco de dados encerrada');
  });

module.exports = main;