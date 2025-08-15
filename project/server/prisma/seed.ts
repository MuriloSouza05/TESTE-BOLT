import { PrismaClient, PlanType, AccountType, ProjectStatus, TaskStatus, Priority, InvoiceStatus, TransactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados para PRODUÇÃO...');

  // Limpar dados existentes
  console.log('🗑️ Limpando dados existentes...');
  await prisma.auditLog.deleteMany();
  await prisma.file.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  console.log('✅ Dados existentes removidos');

  // Criar 3 empresas de teste (uma para cada tipo de conta)
  console.log('🏢 Criando empresas de teste...');
  const tenants = await Promise.all([
    // Empresa com Conta Simples
    prisma.tenant.create({
      data: {
        companyName: 'Advocacia Simples Ltda',
        cnpj: '12.345.678/0001-01',
        planType: PlanType.SIMPLE,
        isActive: true,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 ano
        maxSimpleAccounts: 2,
        maxCompositeAccounts: 0,
        maxManagerialAccounts: 0
      }
    }),
    // Empresa com Conta Composta
    prisma.tenant.create({
      data: {
        companyName: 'Escritório Composto & Associados',
        cnpj: '23.456.789/0001-02',
        planType: PlanType.COMPOSITE,
        isActive: true,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 ano
        maxSimpleAccounts: 3,
        maxCompositeAccounts: 2,
        maxManagerialAccounts: 0
      }
    }),
    // Empresa com Conta Gerencial
    prisma.tenant.create({
      data: {
        companyName: 'Mega Escritório Gerencial S/A',
        cnpj: '34.567.890/0001-03',
        planType: PlanType.MANAGERIAL,
        isActive: true,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 ano
        maxSimpleAccounts: 5,
        maxCompositeAccounts: 3,
        maxManagerialAccounts: 2
      }
    })
  ]);

  console.log(`✅ ${tenants.length} empresas criadas`);

  // Criar usuários para cada tenant
  console.log('👥 Criando usuários de teste...');
  const passwordHash = await bcrypt.hash('123456', 12);
  
  const users = [];
  
  // Usuários para tenant SIMPLE (apenas contas simples)
  const simpleUsers = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@simples.com',
        passwordHash,
        name: 'Admin Simples',
        accountType: AccountType.SIMPLE,
        tenantId: tenants[0].id,
        isActive: true
      }
    }),
    prisma.user.create({
      data: {
        email: 'user@simples.com',
        passwordHash,
        name: 'Usuário Simples',
        accountType: AccountType.SIMPLE,
        tenantId: tenants[0].id,
        isActive: true
      }
    })
  ]);
  
  // Usuários para tenant COMPOSITE (contas simples + compostas)
  const compositeUsers = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@composta.com',
        passwordHash,
        name: 'Admin Composta',
        accountType: AccountType.COMPOSITE,
        tenantId: tenants[1].id,
        isActive: true
      }
    }),
    prisma.user.create({
      data: {
        email: 'user@composta.com',
        passwordHash,
        name: 'Usuário Composta',
        accountType: AccountType.SIMPLE,
        tenantId: tenants[1].id,
        isActive: true
      }
    })
  ]);
  
  // Usuários para tenant MANAGERIAL (todos os tipos de conta)
  const managerialUsers = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@gerencial.com',
        passwordHash,
        name: 'Admin Gerencial',
        accountType: AccountType.MANAGERIAL,
        tenantId: tenants[2].id,
        isActive: true
      }
    }),
    prisma.user.create({
      data: {
        email: 'composta@gerencial.com',
        passwordHash,
        name: 'Usuário Composta',
        accountType: AccountType.COMPOSITE,
        tenantId: tenants[2].id,
        isActive: true
      }
    }),
    prisma.user.create({
      data: {
        email: 'simples@gerencial.com',
        passwordHash,
        name: 'Usuário Simples',
        accountType: AccountType.SIMPLE,
        tenantId: tenants[2].id,
        isActive: true
      }
    })
  ]);
  
  users.push(...simpleUsers, ...compositeUsers, ...managerialUsers);
  console.log(`✅ ${users.length} usuários criados`);

  // Criar alguns clientes para demonstração
  console.log('🏢 Criando clientes de demonstração...');
  const clients = [];
  
  for (let i = 0; i < tenants.length; i++) {
    const tenantClients = await Promise.all([
      prisma.client.create({
        data: {
          name: `Cliente Exemplo ${i + 1}`,
          cpf: `123.456.789-0${i}`,
          email: `cliente${i + 1}@email.com`,
          phone: `(11) 9999${i}-000${i}`,
          address: {
            street: `Rua Exemplo, ${100 + i * 10}`,
            city: 'São Paulo',
            state: 'SP',
            zipCode: `01234-${i}00`,
            country: 'Brasil'
          },
          tenantId: tenants[i].id
        }
      })
    ]);
    clients.push(...tenantClients);
  }
  
  console.log(`✅ ${clients.length} clientes criados`);

  // Criar projetos de demonstração
  console.log('📁 Criando projetos de demonstração...');
  const projects = [];
  
  for (let i = 0; i < tenants.length; i++) {
    if (clients[i]) {
      const tenantProjects = await Promise.all([
        prisma.project.create({
          data: {
            title: `Projeto Exemplo ${i + 1}`,
            description: 'Projeto de demonstração do sistema',
            status: ProjectStatus.IN_PROGRESS,
            startDate: new Date('2024-01-15'),
            endDate: new Date('2024-06-15'),
            budget: 5000.00,
            progress: 25.0,
            tenantId: tenants[i].id,
            clientId: clients[i].id,
            userId: users[i * 2].id
          }
        })
      ]);
      projects.push(...tenantProjects);
    }
  }
  
  console.log(`✅ ${projects.length} projetos criados`);

  // Criar transações apenas para tenants COMPOSITE e MANAGERIAL
  console.log('💳 Criando transações de demonstração...');
  const transactions = [];
  
  for (let i = 1; i < tenants.length; i++) { // Começar do índice 1 (pular SIMPLE)
    const tenantTransactions = await Promise.all([
      // Receitas
      prisma.transaction.create({
        data: {
          type: TransactionType.INCOME,
          amount: 5000.00,
          category: 'Honorários Advocatícios',
          description: 'Pagamento de honorários - Projeto Exemplo',
          date: new Date('2024-01-25'),
          tenantId: tenants[i].id
        }
      }),
      // Despesas
      prisma.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: 1500.00,
          category: 'Aluguel',
          description: 'Aluguel do escritório - Janeiro/2024',
          date: new Date('2024-01-15'),
          isRecurring: true,
          tenantId: tenants[i].id
        }
      })
    ]);
    transactions.push(...tenantTransactions);
  }
  
  console.log(`✅ ${transactions.length} transações criadas`);

  console.log('\n🎉 Seed concluído com sucesso!');
  console.log('\n📊 Resumo dos dados criados:');
  console.log(`   • ${tenants.length} Empresas (tenants)`);
  console.log(`   • ${users.length} Usuários`);
  console.log(`   • ${clients.length} Clientes`);
  console.log(`   • ${projects.length} Projetos`);
  console.log(`   • ${transactions.length} Transações`);
  
  console.log('\n🔑 Credenciais de teste:');
  console.log('   CONTA SIMPLES:');
  console.log('   • admin@simples.com / 123456');
  console.log('   • user@simples.com / 123456');
  console.log('\n   CONTA COMPOSTA:');
  console.log('   • admin@composta.com / 123456');
  console.log('   • user@composta.com / 123456');
  console.log('\n   CONTA GERENCIAL:');
  console.log('   • admin@gerencial.com / 123456');
  console.log('   • composta@gerencial.com / 123456');
  console.log('   • simples@gerencial.com / 123456');
  console.log('\n   ADMIN DO SAAS:');
  console.log('   • admin@saas.com / admin123');
  console.log('   • Chave Admin: your_admin_secret_key_super_secure_2024_production');
  
  console.log('\n🌐 URLs do sistema:');
  console.log('   • Frontend: http://localhost:8080');
  console.log('   • Backend: http://localhost:3000');
  console.log('   • Health Check: http://localhost:3000/health');
  console.log('   • Adminer (DB): http://localhost:8081');
}

main()
  .catch((e) => {
    console.error('❌ Erro durante o seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });