const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

class AdminService {
  // ==================== GESTÃO DE USUÁRIOS ====================
  
  /**
   * Listar todos os usuários com paginação
   */
  async getAllUsers(page = 1, limit = 20, search = '') {
    const skip = (page - 1) * limit;
    
    const where = search ? {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { cpf: { contains: search } }
      ]
    } : {};

    // Não filtrar por deleted_at para mostrar todos os usuários (ativos e inativos)

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: {
          ...where,
          // Remover filtro deleted_at para mostrar todos os usuários
        },
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          cpf: true,
          full_name: true,
          is_admin: true,
          is_influencer: true,
          deleted_at: true, // Para verificar se está ativo
          created_at: true,
          updated_at: true,
          wallet: {
            select: {
              balance: true
            }
          },
          _count: {
            select: {
              deposits: true,
              withdraws: true,
              games: true,
              invitedUsers: true
            }
          }
        },
        orderBy: { created_at: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    // Adicionar campo is_active baseado no deleted_at
    const usersWithStatus = users.map(user => ({
      ...user,
      is_active: user.deleted_at === null
    }));

    return {
      users: usersWithStatus,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Obter usuário por ID
   */
  async getUserById(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        inviteCode: {
          select: {
            code: true,
            commission_rate: true,
            total_invites: true,
            total_commission: true,
          }
        },
        wallet: {
          select: {
            balance: true
          }
        },
        deposits: {
          orderBy: { created_at: 'desc' },
          take: 10
        },
        withdraws: {
          orderBy: { created_at: 'desc' },
          take: 10
        },
        games: {
          orderBy: { created_at: 'desc' },
          take: 10,
          include: {
            scratchCard: {
              select: { name: true, price: true }
            }
          }
        },
        invitedUsers: {
          select: {
            id: true,
            username: true,
            created_at: true
          }
        },
        inviter: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    return user;
  }

  /**
   * Atualizar usuário
   */
  async updateUser(userId, updateData) {
    const allowedFields = ['username', 'email', 'cpf', 'full_name', 'is_admin'];
    const filteredData = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredData[key] = updateData[key];
      }
    });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...filteredData,
        updated_at: new Date()
      }
    });

    return user;
  }

  /**
   * Desativar/Ativar usuário
   */
  async toggleUserStatus(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deleted_at: true }
    });

    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    const isCurrentlyActive = user.deleted_at === null;
    
    return await prisma.user.update({
      where: { id: userId },
      data: {
        deleted_at: isCurrentlyActive ? new Date() : null,
        updated_at: new Date()
      }
    });
  }

  // ==================== GESTÃO DE DEPÓSITOS ====================
  
  /**
   * Listar todos os depósitos
   */
  async getAllDeposits(page = 1, limit = 20, status = null) {
    const skip = (page - 1) * limit;
    
    // Converter string status para boolean
    let where = {};
    if (status !== null) {
      if (status === 'PENDING') {
        where.status = false;
      } else if (status === 'APPROVED') {
        where.status = true;
      }
    }

    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        },
        orderBy: { created_at: 'desc' }
      }),
      prisma.deposit.count({ where })
    ]);

    return {
      deposits,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Aprovar depósito
   */
  async approveDeposit(depositId, adminId) {
    return await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { id: depositId },
        include: { user: true }
      });

      if (!deposit) {
        throw new Error('Depósito não encontrado');
      }

      if (deposit.status !== false) {
        throw new Error('Apenas depósitos pendentes podem ser aprovados');
      }

      // Atualizar status do depósito
      const updatedDeposit = await tx.deposit.update({
        where: { id: depositId },
        data: {
          status: true,
          paid_at: new Date()
        }
      });

      // Adicionar valor ao saldo do usuário
      await tx.wallet.update({
        where: { userId: deposit.userId },
        data: {
          balance: {
            increment: deposit.amount
          }
        }
      });

      return updatedDeposit;
    });
  }

  /**
   * Rejeitar depósito
   */
  async rejectDeposit(depositId, adminId, reason = '') {
    const deposit = await prisma.deposit.findUnique({
      where: { id: depositId }
    });

    if (!deposit) {
      throw new Error('Depósito não encontrado');
    }

    if (deposit.status !== false) {
      throw new Error('Apenas depósitos pendentes podem ser rejeitados');
    }

    return await prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: false,
        metadata: {
          ...deposit.metadata,
          rejection_reason: reason,
          rejected_at: new Date()
        }
      }
    });
  }

  // ==================== GESTÃO DE SAQUES ====================
  
  /**
   * Listar todos os saques
   */
  async getAllWithdrawals(page = 1, limit = 20, status = null) {
    const skip = (page - 1) * limit;
    
    // Converter string status para boolean
    let where = {};
    if (status !== null) {
      if (status === 'PENDING') {
        where.status = false;
      } else if (status === 'APPROVED') {
        where.status = true;
      }
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdraw.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        },
        orderBy: { created_at: 'desc' }
      }),
      prisma.withdraw.count({ where })
    ]);

    return {
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Aprovar saque e processar pagamento via gateway (DigitoPay ou PixUp)
   */
  async approveWithdrawal(withdrawalId, adminId, gateway = 'pluggou') {
    const pixupService = require('./payments/pixup.service');
    const digitoService = require('./payments/digito.service');
    const pluggouService = require('./payments/pluggou.service');
    
    return await prisma.$transaction(async (tx) => {
      // Buscar saque com dados do usuário
      const withdrawal = await tx.withdraw.findUnique({
        where: { id: withdrawalId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              full_name: true,
              cpf: true
            }
          }
        }
      });

      if (!withdrawal) {
        throw new Error('Saque não encontrado');
      }

      if (withdrawal.status !== false) {
        throw new Error('Apenas saques pendentes podem ser aprovados');
      }

      try {
        let paymentResponse;
        let gatewayName;

        if (gateway === 'digito') {
          // Processar pagamento via DigitoPay
          const paymentData = {
            amount: Number(withdrawal.amount),
            description: `Saque aprovado - ${withdrawal.user.username}`,
            external_id: withdrawal.id,
            pixKey: withdrawal.pix_key,
            recipientName: withdrawal.user.full_name || withdrawal.user.username,
            keyType: withdrawal.pix_type, // Tipo da chave PIX (CPF, CNPJ, EMAIL, PHONE, EVP)
            taxId: withdrawal.document || withdrawal.user.cpf // CPF/CNPJ do destinatário
          };

          paymentResponse = await digitoService.processPayment(paymentData);
          gatewayName = 'DigitoPay';
        } else if (gateway === 'pluggou') {
          // Processar pagamento via Pluggou
          const paymentData = {
            amount: Number(withdrawal.amount),
            description: `Saque aprovado - ${withdrawal.user.username}`,
            pixKey: withdrawal.pix_key,
            keyType: withdrawal.pix_type,
          };

          paymentResponse = await pluggouService.createPixCashOut(paymentData);
          gatewayName = 'Pluggou';
        } else {
          // Processar pagamento via PixUp (fallback)
          const paymentData = {
            amount: Number(withdrawal.amount),
            description: `Saque aprovado - ${withdrawal.user.username}`,
            external_id: withdrawal.id,
            pixKey: withdrawal.pix_key,
            recipientName: withdrawal.user.full_name || withdrawal.user.username,
            keyType: withdrawal.pix_type,
            taxId: withdrawal.document || withdrawal.user.cpf
          };

          paymentResponse = await pixupService.processPayment(paymentData);
          gatewayName = 'PixUp';
        }

        if (!paymentResponse.success) {
          throw new Error(`Erro no ${gatewayName}: ${paymentResponse.error || 'Falha no processamento'}`);
        }

        // Atualizar saque com dados do pagamento
        const metadata = {
          ...withdrawal.metadata,
          gateway: gateway,
          approved_by: adminId,
          approved_at: new Date()
        };

        // Adicionar dados específicos do gateway
        if (gateway === 'digito') {
          metadata.digito_transaction_id = paymentResponse.digitoTransactionId;
          metadata.digito_response = paymentResponse.data;
          metadata.digito_status = paymentResponse.status;
        } else if (gateway === 'pluggou') {
          metadata.pluggou_transaction_id = paymentResponse.transactionId;
          metadata.pluggou_response = paymentResponse.data;
          metadata.pluggou_status = paymentResponse.status;
        } else {
          metadata.pixup_transaction_id = paymentResponse.pixupTransactionId;
          metadata.pixup_response = paymentResponse.data;
          metadata.pixup_status = paymentResponse.status;
        }

        const updatedWithdrawal = await tx.withdraw.update({
          where: { id: withdrawalId },
          data: {
            status: true,
            processed_at: new Date(),
            metadata: metadata
          }
        });

        console.log(`✅ Saque aprovado e pagamento processado via ${gatewayName}:`, {
          withdrawalId: withdrawal.id,
          userId: withdrawal.userId,
          amount: withdrawal.amount,
          transactionId: gateway === 'digito' ? paymentResponse.digitoTransactionId : gateway === 'pluggou' ? paymentResponse.transactionId : paymentResponse.pixupTransactionId
        });

        return updatedWithdrawal;
      } catch (paymentError) {
        console.error(`❌ Erro ao processar pagamento ${gateway}:`, paymentError.message);
        
        // Atualizar saque com erro
        await tx.withdraw.update({
          where: { id: withdrawalId },
          data: {
            metadata: {
              ...withdrawal.metadata,
              [`${gateway}_error`]: paymentError.message,
              approval_failed_at: new Date(),
              approved_by: adminId
            }
          }
        });

        throw new Error(`Erro ao processar pagamento: ${paymentError.message}`);
      }
    });
  }

  /**
   * Rejeitar saque
   */
  async rejectWithdrawal(withdrawalId, adminId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdraw.findUnique({
        where: { id: withdrawalId }
      });

      if (!withdrawal) {
        throw new Error('Saque não encontrado');
      }

      if (withdrawal.status !== false) {
        throw new Error('Apenas saques pendentes podem ser rejeitados');
      }

      // Rejeitar saque
      const updatedWithdrawal = await tx.withdraw.update({
        where: { id: withdrawalId },
        data: {
          status: false,
          amount: 0,
          metadata: {
            ...withdrawal.metadata,
            rejection_reason: reason,
            rejected_at: new Date()
          }
        }
      });

      // Devolver valor ao saldo do usuário
      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          balance: {
            increment: withdrawal.amount
          }
        }
      });

      return updatedWithdrawal;
    });
  }

  // ==================== ESTATÍSTICAS DO SISTEMA ====================
  
  /**
   * Obter estatísticas completas do sistema
   */
  async getSystemStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Estatísticas de depósitos
    const [depositStats, withdrawalStats, userStats, gameStats] = await Promise.all([
      // Depósitos
      prisma.deposit.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: false } // PENDING
      }).then(async (pending) => {
        const approved = await prisma.deposit.aggregate({
          _sum: { amount: true },
          _count: true,
          where: { status: true } // APPROVED
        });
        const rejected = await prisma.deposit.aggregate({
          _sum: { amount: true },
          _count: true,
          where: { 
            status: false,
            metadata: {
              path: ['rejection_reason'],
              not: null
            }
          } // REJECTED
        });
        const total = await prisma.deposit.aggregate({
          _sum: { amount: true },
          _count: true
        });
        return { pending, approved, rejected, total };
      }),
      
      // Saques
      prisma.withdraw.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: false } // PENDING
      }).then(async (pending) => {
        const approved = await prisma.withdraw.aggregate({
          _sum: { amount: true },
          _count: true,
          where: { status: true } // APPROVED
        });
        const rejected = await prisma.withdraw.aggregate({
          _sum: { amount: true },
          _count: true,
          where: {
            status: false,
            metadata: {
              path: ['rejection_reason'],
              not: null
            }
          } // REJECTED
        });
        const total = await prisma.withdraw.aggregate({
          _sum: { amount: true },
          _count: true
        });
        return { pending, approved, rejected, total };
      }),
      
      // Usuários e afiliados
      prisma.user.count().then(async (totalUsers) => {
        const todayUsers = await prisma.user.count({
          where: {
            created_at: {
              gte: today,
              lt: tomorrow
            }
          }
        });
        const totalAffiliates = await prisma.user.count({
          where: {
            invitedBy: { not: null }
          }
        });
        const todayAffiliates = await prisma.user.count({
          where: {
            invitedBy: { not: null },
            created_at: {
              gte: today,
              lt: tomorrow
            }
          }
        });
        const totalBalance = await prisma.wallet.aggregate({
          _sum: { balance: true }
        });
        return {
          totalUsers,
          todayUsers,
          totalAffiliates,
          todayAffiliates,
          totalBalance: totalBalance._sum.balance || 0
        };
      }),
      
      // Jogos e apostas
      prisma.game.aggregate({
        _sum: { amount_won: true },
        _count: true
      }).then(async (games) => {
        const scratchCards = await prisma.scratchCard.aggregate({
          _sum: { total_revenue: true, total_payouts: true }
        });
        const totalBet = scratchCards._sum.total_revenue || 0;
        const totalPrizeValue = scratchCards._sum.total_payouts || 0;
        const totalGames = games._count;
        const profit = totalBet - totalPrizeValue;
        
        return {
          totalBet,
          totalPrizeValue,
          totalGames,
          profit
        };
      })
    ]);

    // Calcular comissões (assumindo 5% de comissão sobre apostas dos afiliados)
    const commissionRate = 0.05;
    const affiliateGames = await prisma.game.aggregate({
      _sum: { amount_won: true },
      where: {
        user: {
          invitedBy: { not: null }
        }
      }
    });
    const totalCommissions = (affiliateGames._sum.bet_amount || 0) * commissionRate;

    return {
      deposits: {
        pending: {
          amount: depositStats.pending._sum.amount || 0,
          count: depositStats.pending._count
        },
        approved: {
          amount: depositStats.approved._sum.amount || 0,
          count: depositStats.approved._count
        },
        rejected: {
          amount: depositStats.rejected._sum.amount || 0,
          count: depositStats.rejected._count
        },
        total: {
          amount: depositStats.total._sum.amount || 0,
          count: depositStats.total._count
        }
      },
      withdrawals: {
        pending: {
          amount: withdrawalStats.pending._sum.amount || 0,
          count: withdrawalStats.pending._count
        },
        approved: {
          amount: withdrawalStats.approved._sum.amount || 0,
          count: withdrawalStats.approved._count
        },
        rejected: {
          amount: withdrawalStats.rejected._sum.amount || 0,
          count: withdrawalStats.rejected._count
        },
        total: {
          amount: withdrawalStats.total._sum.amount || 0,
          count: withdrawalStats.total._count
        }
      },
      users: {
        total: userStats.totalUsers,
        today: userStats.todayUsers,
        totalBalance: userStats.totalBalance
      },
      affiliates: {
        total: userStats.totalAffiliates,
        today: userStats.todayAffiliates,
        totalCommissions
      },
      games: {
        totalBet: gameStats.totalBet,
        totalDistributed: gameStats.totalPrizeValue,
        totalGames: gameStats.totalGames,
        profit: gameStats.profit
      },
      summary: {
        totalRevenue: gameStats.totalBet,
        totalCosts: gameStats.totalPrizeValue + totalCommissions,
        netProfit: gameStats.profit - totalCommissions,
        totalInWallets: userStats.totalBalance
      }
    };
  }

  /**
   * Obter estatísticas por período
   */
  async getStatsByPeriod(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const [deposits, withdrawals, gamesData, newUsers] = await Promise.all([
      prisma.deposit.aggregate({
        _sum: { amount: true },
        _count: true,
        where: {
          created_at: {
            gte: start,
            lte: end
          }
        }
      }),
      prisma.withdraw.aggregate({
        _sum: { amount: true },
        _count: true,
        where: {
          created_at: {
            gte: start,
            lte: end
          }
        }
      }),
      prisma.game.aggregate({
        _sum: { amount_won: true },
        _count: true,
        where: {
          created_at: {
            gte: start,
            lte: end
          }
        }
      }).then(async (games) => {
        const scratchCards = await prisma.scratchCard.aggregate({
          _sum: { total_revenue: true, total_payouts: true },
          where: {
            updated_at: {
              gte: start,
              lte: end
            }
          }
        });
        return {
          games,
          scratchCards
        };
      }),
      prisma.user.count({
        where: {
          created_at: {
            gte: start,
            lte: end
          }
        }
      })
    ]);

    // Calcular comissões do período
    const affiliateGamesInPeriod = await prisma.game.aggregate({
      _sum: { amount_won: true },
      where: {
        created_at: {
          gte: start,
          lte: end
        },
        user: {
          invitedBy: { not: null }
        }
      }
    });

    const commissionRate = 0.05;
    const totalBet = gamesData.scratchCards._sum.total_revenue || 0;
    const totalPrizes = gamesData.scratchCards._sum.total_payouts || 0;
    const totalCommissions = (affiliateGamesInPeriod._sum.amount_won || 0) * commissionRate;

    return {
       period: {
         start: startDate,
         end: endDate
       },
       deposits: {
         total: deposits._sum.amount || 0,
         count: deposits._count || 0
       },
       withdrawals: {
         total: withdrawals._sum.amount || 0,
         count: withdrawals._count || 0
       },
       games: {
         totalBet,
         totalDistributed: totalPrizes,
         count: gamesData.games._count,
         profit: totalBet - totalPrizes
       },
       affiliates: {
         newAffiliates: newUsers,
         totalCommissions
       }
     };
  }

  /**
   * Adicionar saldo a um usuário
   */
  async adjustUserBalance(userId, amount) {
    try {
      if (typeof amount !== 'number' || isNaN(amount) || amount === 0) {
        throw new Error('Valor inválido para ajuste de saldo.');
      }
      // Buscar carteira do usuário
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new Error('Carteira do usuário não encontrada.');

      // Não permitir saldo negativo final
      if (wallet.balance + amount < 0) {
        throw new Error('Saldo insuficiente para desconto.');
      }

      const updated = await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: amount }
        }
      });
      return {
        success: true,
        data: updated,
        message: amount > 0
          ? `Saldo adicionado com sucesso: +${amount}`
          : `Saldo descontado com sucesso: ${amount}`
      };
    } catch (error) {
      console.error('❌ Erro ao ajustar saldo do usuário:', error.message);
      return {
        success: false,
        data: null,
        message: error.message || 'Erro ao ajustar saldo do usuário.'
      };
    }
  }

  /**
   * Editar porcentagem de comissão do afiliado
   */
  async editAffiliateCommission(userId, commission_rate) {
    try {
      if (commission_rate < 0 || commission_rate > 100) throw new Error('Porcentagem de comissão inválida.');

      // Busca o InviteCode do afiliado
      const inviteCode = await prisma.inviteCode.findUnique({ where: { userId } });
      if (!inviteCode) throw new Error('InviteCode não encontrado para este usuário.');

      const updated = await prisma.inviteCode.update({
        where: { userId },
        data: { commission_rate }
      });

      return {
        success: true,
        data: updated,
        message: `Porcentagem de comissão atualizada com sucesso: ${commission_rate}%`
      };
    } catch (error) {
      console.error('❌ Erro ao editar porcentagem de comissão do afiliado:', error.message);
      return {
        success: false,
        data: null,
        message: error.message || 'Erro ao editar porcentagem de comissão do afiliado.'
      };
    }
  }


  /**
 * Ajustar manualmente o total_commission e/ou total_invites do afiliado (InviteCode)
 * @param {string} userId - ID do usuário afiliado
 * @param {number} commissionDelta - Valor a somar/subtrair em total_commission (pode ser negativo)
 * @param {number} invitesDelta - Valor a somar/subtrair em total_invites (pode ser negativo)
 * @returns {Promise<Object>} InviteCode atualizado
 */
async adjustAffiliateTotals(userId, commissionDelta = 0, invitesDelta = 0) {
  try {
    const inviteCode = await prisma.inviteCode.findUnique({ where: { userId } });
    if (!inviteCode) throw new Error('InviteCode não encontrado para este usuário.');

    // Não permite deixar valores negativos
    const newTotalCommission = Number(inviteCode.total_commission) + Number(commissionDelta);
    const newTotalInvites = Number(inviteCode.total_invites) + Number(invitesDelta);
    if (newTotalCommission < 0 || newTotalInvites < 0) {
      throw new Error('Não é permitido deixar total_commission ou total_invites negativo.');
    }

    const updated = await prisma.inviteCode.update({
      where: { userId },
      data: {
        ...(commissionDelta !== 0 && { total_commission: { increment: commissionDelta } }),
        ...(invitesDelta !== 0 && { total_invites: { increment: invitesDelta } })
      }
    });

    return {
      success: true,
      data: updated,
      message: 'Totais do afiliado ajustados com sucesso!'
    };
  } catch (error) {
    console.error('❌ Erro ao ajustar totais do afiliado:', error.message);
    return {
      success: false,
      data: null,
      message: error.message || 'Erro ao ajustar totais do afiliado.'
    };
  }
}

/**
 * Retorna todos os usuários convidados (afiliados) por um usuário específico (admin view)
 * @param {string} userId - ID do usuário afiliador
 * @returns {Promise<Array>} Lista de usuários convidados
 */
async getInvitedUsersByAdmin(userId) {
  try {
    const invitedUsers = await prisma.user.findMany({
      where: { invitedBy: userId },
      select: {
        id: true,
        full_name: true,
        username: true,
        email: true,
        phone: true,
        cpf: true,
        password: false, // Não retornar senha por segurança
        is_admin: true,
        is_influencer: true,
        total_scratchs: true,
        total_wins: true,
        total_losses: true,
        total_deposit: true,
        total_withdraw: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        deposits: {
          select: {
            amount: true,
            status: true,
            created_at: true
          }
        },
        withdraws: {
          select: {
            amount: true,
            status: true,
            created_at: true
          }
        },
        wallet: {
          select: {
            balance: true
          }
        }
      }
    });
    return {
      success: true,
      data: invitedUsers,
      message: 'Usuários convidados recuperados com sucesso.'
    };
  } catch (error) {
    console.error('Erro ao buscar usuários convidados pelo admin:', error.message);
    return {
      success: false,
      data: null,
      message: error.message || 'Erro ao buscar usuários convidados.'
    };
  }
}

/**
 *Deve tornar ou desativar status is_featured de uma raspadinha
 */
async toggleScratchCardFeatured(scratchCardId, isFeatured) {
  try {
    const scratchCard = await prisma.scratchCard.findUnique({ where: { id: scratchCardId } });
    if (!scratchCard) throw new Error('Raspadinha não encontrada.');
    // Verifica se tem mais de 4 raspadinhas com is_featured true
    const featuredScratchCards = await prisma.scratchCard.findMany({
      where: { is_featured: true }
    });
    if (featuredScratchCards.length >= 4 && !isFeatured) {
      throw new Error('Não é permitido ativar mais de 4 raspadinhas como destacadas.');
    }
    const updated = await prisma.scratchCard.update({
      where: { id: scratchCardId },
      data: { is_featured: isFeatured }
    });

    return {
      success: true,
      data: updated,
      message: isFeatured ? 'Raspadinha ativada como destacada com sucesso.' : 'Raspadinha desativada como destacada com sucesso.'
    };
  } catch (error) {
    console.error('Erro ao ativar/desativar raspadinha:', error.message);
    return {
      success: false,
      data: null,
      message: error.message || 'Erro ao ativar/desativar raspadinha.'
    };
  }
}

/**
 * Deve ativar ou desativar status is_influencer de um usuário
 */
async toggleIsInfluencer(userId, isInfluencer) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Usuário não encontrado.');
    const updated = await prisma.user.update({ where: { id: userId }, data: { is_influencer: isInfluencer } });
    return { success: true, data: updated, message: 'Status de influencer atualizado com sucesso.' };
  } catch (error) {
    console.error('Erro ao ativar/desativar influencer:', error.message);
    return {
      success: false,
      data: null,
      message: error.message || 'Erro ao ativar/desativar influencer.'
    };
  }
}

/**
 * 
 */
}

module.exports = new AdminService();